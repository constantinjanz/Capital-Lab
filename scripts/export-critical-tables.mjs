import { spawn, spawnSync } from 'node:child_process'
import {
  chmod,
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'

import {
  BACKUP_ARTIFACT_KEYS,
  assertContractKeys,
  buildCriticalEvidenceSql,
  buildRolePolicySql,
  buildServerIdentitySql,
  canonicalJson,
  criticalRelationSchemas,
  fingerprintRolePolicy,
  loadCriticalRelationContract,
  postgresUrlToLibpqEnv,
  redactedPostgresError,
  sha256,
} from './critical-backup-contract.mjs'
import { canonicalRepositoryTextBytes } from './lib/canonical-repository-bytes.mjs'
import {
  resolvedArguments,
  resolveNativeExecutable,
} from './lib/safe-process.mjs'

const SUPABASE_CLI_VERSION = '2.113.0'
const PROCESS_TIMEOUT_MS = 600_000

function options() {
  const entries = process.argv.slice(2).map((argument) => {
    const match = /^--(contract|output-dir)=(.+)$/u.exec(argument)
    if (!match) throw new Error('Backup arguments are invalid')
    return [match[1], match[2]]
  })
  const parsed = Object.fromEntries(entries)
  if (
    entries.length !== 2 ||
    new Set(entries.map(([key]) => key)).size !== 2 ||
    !['pre', 'post'].includes(parsed.contract)
  ) {
    throw new Error(
      'Required: --contract=pre|post --output-dir=<new-external-directory>',
    )
  }
  return parsed
}

function git(args, cwd) {
  const executable = resolveNativeExecutable('git')
  const result = spawnSync(
    executable.command,
    resolvedArguments(executable, args),
    {
      cwd,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    },
  )
  if (result.status !== 0 || result.signal || result.error) {
    throw new Error('Git evidence could not be derived')
  }
  return result.stdout.trim()
}

async function exists(filename) {
  try {
    await stat(filename)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function run(executableName, args, env, input) {
  const executable = resolveNativeExecutable(executableName)
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    const child = spawn(
      executable.command,
      resolvedArguments(executable, args),
      {
        env,
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )
    child.stdout.on('data', (chunk) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()))
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, PROCESS_TIMEOUT_MS)
    child.once('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code !== 0 || signal || timedOut) {
        reject(
          new Error(
            `PostgreSQL backup step failed; redacted database error: ${redactedPostgresError(stderr)}`,
          ),
        )
      } else resolve({ stdout, stderr })
    })
    child.stdin.end(input)
  })
}

async function evidence(connectionEnv, sql) {
  const result = await run(
    'psql',
    [
      '-X',
      '--no-psqlrc',
      '--tuples-only',
      '--no-align',
      '--set',
      'ON_ERROR_STOP=1',
    ],
    {
      ...process.env,
      ...connectionEnv,
      PGCONNECT_TIMEOUT: '10',
      PGOPTIONS: '-c statement_timeout=300000 -c lock_timeout=10000',
    },
    sql,
  )
  return JSON.parse(result.stdout.trim())
}

async function toolVersion(name) {
  const executable = resolveNativeExecutable(name)
  const result = spawnSync(
    executable.command,
    resolvedArguments(executable, ['--version']),
    {
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    },
  )
  if (result.status !== 0 || result.signal || result.error) {
    throw new Error(`${name} is unavailable`)
  }
  return result.stdout.trim()
}

async function main() {
  const requested = options()
  const workspace = await realpath(process.cwd())
  if (git(['status', '--porcelain=v1', '--untracked-files=all'], workspace)) {
    throw new Error('Backup creation requires a completely clean Working Tree')
  }
  const commitSha = git(['rev-parse', 'HEAD'], workspace)
  if (!/^[0-9a-f]{40}$/u.test(commitSha))
    throw new Error('Exact Git HEAD is invalid')
  const outputPath = path.resolve(requested['output-dir'])
  const relative = path.relative(workspace, outputPath)
  if (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  ) {
    throw new Error('Backup output must resolve outside the repository')
  }
  if (await exists(outputPath))
    throw new Error('Backup output directory must not already exist')
  await mkdir(outputPath, { recursive: false, mode: 0o700 })
  let completed = false
  try {
    const databaseUrl = process.env.CAPITAL_LAB_DATABASE_URL
    if (!databaseUrl)
      throw new Error('CAPITAL_LAB_DATABASE_URL is required and never printed')
    const connection = postgresUrlToLibpqEnv(databaseUrl)
    const contractKind =
      requested.contract === 'pre' ? 'pre_activation' : 'post_activation'
    const contractPath = path.join(
      workspace,
      'supabase',
      'backup',
      requested.contract === 'pre'
        ? 'pre-activation.v1.json'
        : 'post-activation.v1.json',
    )
    const { contract, sha256: relationContractSha256 } =
      await loadCriticalRelationContract(contractPath, contractKind)
    const dataSchemas = criticalRelationSchemas(contract)
    const migrationDirectory = path.join(workspace, 'supabase', 'migrations')
    for (const migration of contract.migrations) {
      if (
        sha256(
          canonicalRepositoryTextBytes(
            await readFile(path.join(migrationDirectory, migration.name)),
          ),
        ) !== migration.sha256
      ) {
        throw new Error('Backup migration checksum contract drifted')
      }
    }
    const restorePreludePath = path.join(
      workspace,
      'supabase',
      'backup',
      'seed-free-target-prelude.sql',
    )
    const restorePreludeSha256 = sha256(await readFile(restorePreludePath))
    const supabaseVersion = await toolVersion('supabase')
    if (supabaseVersion !== SUPABASE_CLI_VERSION) {
      throw new Error(`Supabase CLI ${SUPABASE_CLI_VERSION} is required`)
    }
    const psqlVersion = await toolVersion('psql')
    const pgDumpVersion = await toolVersion('pg_dump')
    const pgDumpallVersion = await toolVersion('pg_dumpall')
    const evidenceSql = buildCriticalEvidenceSql(contract)
    const evidenceBefore = await evidence(connection.libpqEnv, evidenceSql)
    assertContractKeys(contract, evidenceBefore)
    const identityBefore = await evidence(
      connection.libpqEnv,
      buildServerIdentitySql(),
    )
    const rolePolicyBefore = await evidence(
      connection.libpqEnv,
      buildRolePolicySql(),
    )
    if (
      canonicalJson(evidenceBefore.appliedMigrations) !==
      canonicalJson(
        contract.migrations.map(({ name, version }) => ({
          name: name.slice(15, -4),
          version,
        })),
      )
    ) {
      throw new Error(
        'Source migration history differs from the selected backup contract',
      )
    }
    const paths = {
      roles: path.join(outputPath, 'roles.sql'),
      schema: path.join(outputPath, 'schema.sql'),
      data: path.join(outputPath, 'data.sql'),
      historySchema: path.join(outputPath, 'migration-history-schema.sql'),
      historyData: path.join(outputPath, 'migration-history-data.sql'),
      manifest: path.join(outputPath, 'manifest.json'),
    }
    const dumpEnv = {
      ...process.env,
      ...connection.libpqEnv,
      PGCONNECT_TIMEOUT: '10',
      PGOPTIONS: '-c statement_timeout=300000 -c lock_timeout=10000',
    }
    await run(
      'pg_dumpall',
      ['--roles-only', '--no-role-passwords', '--file', paths.roles],
      dumpEnv,
    )
    await run(
      'pg_dump',
      [
        '--schema-only',
        '--no-owner',
        '--schema',
        'public',
        '--schema',
        'private',
        '--file',
        paths.schema,
      ],
      dumpEnv,
    )
    await run(
      'pg_dump',
      [
        '--data-only',
        '--no-owner',
        '--no-privileges',
        '--schema',
        'public',
        '--schema',
        'private',
        '--file',
        paths.data,
      ],
      dumpEnv,
    )
    await run(
      'pg_dump',
      [
        '--schema-only',
        '--no-owner',
        '--schema',
        'supabase_migrations',
        '--file',
        paths.historySchema,
      ],
      dumpEnv,
    )
    await run(
      'pg_dump',
      [
        '--data-only',
        '--no-owner',
        '--no-privileges',
        '--schema',
        'supabase_migrations',
        '--file',
        paths.historyData,
      ],
      dumpEnv,
    )
    for (const key of BACKUP_ARTIFACT_KEYS) await chmod(paths[key], 0o600)
    const evidenceAfter = await evidence(connection.libpqEnv, evidenceSql)
    assertContractKeys(contract, evidenceAfter)
    const identityAfter = await evidence(
      connection.libpqEnv,
      buildServerIdentitySql(),
    )
    const rolePolicyAfter = await evidence(
      connection.libpqEnv,
      buildRolePolicySql(),
    )
    if (
      canonicalJson(evidenceBefore) !== canonicalJson(evidenceAfter) ||
      canonicalJson(identityBefore) !== canonicalJson(identityAfter) ||
      canonicalJson(rolePolicyBefore) !== canonicalJson(rolePolicyAfter)
    ) {
      throw new Error(
        'Backup source changed or database identity switched during export',
      )
    }
    const artifacts = {}
    for (const key of BACKUP_ARTIFACT_KEYS) {
      artifacts[key] = {
        file: path.basename(paths[key]),
        sha256: sha256(await readFile(paths[key])),
      }
    }
    const manifest = {
      artifacts,
      contractKind,
      createdAt: new Date().toISOString(),
      dataSchemas,
      gitCommitSha: commitSha,
      migrations: contract.migrations,
      relationContractSha256,
      relationSetSha256: evidenceBefore.relationSetSha256,
      relations: evidenceBefore.relations,
      restorePreludeSha256,
      schemaContractVersion: `capital-lab-${contractKind}-backup-v4`,
      schemaFingerprintSha256: evidenceBefore.schemaFingerprintSha256,
      schemaVersion: 4,
      source: {
        appliedMigrations: evidenceBefore.appliedMigrations,
        databaseFingerprint: evidenceBefore.databaseFingerprint,
        rolePolicyFingerprint: fingerprintRolePolicy(rolePolicyBefore),
        schemaFingerprintSha256: evidenceBefore.schemaFingerprintSha256,
        serverFingerprint: sha256(identityBefore.serverIdentity),
        serverVersion: evidenceBefore.serverVersion,
      },
      toolVersions: {
        pgDump: pgDumpVersion,
        pgDumpall: pgDumpallVersion,
        psql: psqlVersion,
        supabase: supabaseVersion,
      },
    }
    const manifestBytes = Buffer.from(`${canonicalJson(manifest)}\n`)
    await writeFile(paths.manifest, manifestBytes, { mode: 0o600, flag: 'wx' })
    completed = true
    process.stdout.write(
      `${JSON.stringify({ status: 'sensitive_backup_created', contractKind, relationCount: contract.relations.length, manifestSha256: sha256(manifestBytes) })}\n`,
    )
  } finally {
    if (!completed) await rm(outputPath, { recursive: true, force: true })
  }
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Backup failed closed')
  process.exit(1)
})
