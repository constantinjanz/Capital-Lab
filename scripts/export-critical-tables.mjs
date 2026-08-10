import { spawn, spawnSync } from 'node:child_process'
import { mkdir, readFile, realpath, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  buildCriticalEvidenceSql,
  buildRolePolicySql,
  buildServerIdentitySql,
  canonicalJson,
  fingerprintRolePolicy,
  loadCriticalRelationContract,
  postgresUrlToLibpqEnv,
  redactedPostgresError,
  sha256,
} from './critical-backup-contract.mjs'

const SUPABASE_CLI_VERSION = '2.113.0'
const PROCESS_TIMEOUT_MS = 600_000

function fail(message) {
  throw new Error(message)
}

function onlyOption(name) {
  const prefix = `--${name}=`
  const values = process.argv
    .slice(2)
    .filter((value) => value.startsWith(prefix))
  if (values.length !== 1 || process.argv.length !== 3) return undefined
  return values[0].slice(prefix.length)
}

function git(args, cwd) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  })
  if (result.status !== 0) fail('Git evidence could not be derived')
  return result.stdout.trim()
}

function redactedDirtyPathSummary(status) {
  return status
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => {
      const state = line.slice(0, 2)
      const filePath = line.slice(3).replaceAll('\\', '/')
      const sensitivePath = filePath
        .split('/')
        .some((part) => /^\.env(?:\.|$)/iu.test(part) || part === '.npmrc')
      return `${state}:${sensitivePath ? '[sensitive-path]' : filePath}`
    })
    .join(', ')
}

async function spawnBounded(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const { input, ...spawnOptions } = options
    const child = spawn(command, args, {
      ...spawnOptions,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    child.stdout.on('data', (chunk) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()))
    child.once('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    const timer = setTimeout(() => child.kill('SIGTERM'), PROCESS_TIMEOUT_MS)
    child.once('exit', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, signal, stdout, stderr })
    })
    if (input) child.stdin.end(input)
    else child.stdin.end()
  })
}

async function psqlEvidence(psql, connectionEnv, sql) {
  const result = await spawnBounded(
    psql,
    [
      '-X',
      '--no-psqlrc',
      '--tuples-only',
      '--no-align',
      '--set',
      'ON_ERROR_STOP=1',
    ],
    {
      env: {
        ...process.env,
        ...connectionEnv,
        PGCONNECT_TIMEOUT: '10',
        PGOPTIONS: '-c statement_timeout=300000 -c lock_timeout=10000',
      },
      input: sql,
    },
  )
  if (result.code !== 0 || result.signal) {
    fail(
      `Critical backup evidence query failed; redacted database error: ${redactedPostgresError(result.stderr)}`,
    )
  }
  return JSON.parse(result.stdout.trim())
}

async function main() {
  const outputInput = onlyOption('output-dir')
  if (!outputInput) {
    fail('Usage: pnpm backup:critical -- --output-dir=<external-directory>')
  }
  const workspace = await realpath(process.cwd())
  const dirtyStatus = git(
    ['status', '--porcelain=v1', '--untracked-files=all'],
    workspace,
  )
  if (dirtyStatus) {
    fail(
      `Backup creation requires a completely clean Working Tree; path-only evidence: ${redactedDirtyPathSummary(dirtyStatus)}`,
    )
  }
  const commitSha = git(['rev-parse', 'HEAD'], workspace)
  if (!/^[0-9a-f]{40}$/.test(commitSha)) fail('Exact Git HEAD is invalid')

  await mkdir(path.resolve(outputInput), { recursive: true })
  const outputDirectory = await realpath(path.resolve(outputInput))
  const relative = path.relative(workspace, outputDirectory)
  if (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  ) {
    fail('Backup output must resolve outside the repository')
  }
  const databaseUrl = process.env.CAPITAL_LAB_DATABASE_URL
  if (!databaseUrl)
    fail('CAPITAL_LAB_DATABASE_URL is required and never printed')
  const sourceConnection = postgresUrlToLibpqEnv(databaseUrl)

  const contractPath = path.join(
    workspace,
    'supabase',
    'backup',
    'critical-relations.v2.json',
  )
  const { contract, sha256: relationContractSha256 } =
    await loadCriticalRelationContract(contractPath)
  const restorePreludePath = path.join(
    workspace,
    'supabase',
    'backup',
    'seed-free-target-prelude.sql',
  )
  const restorePreludeSha256 = sha256(await readFile(restorePreludePath))
  const migrationDirectory = path.join(workspace, 'supabase', 'migrations')
  const migrationFiles = (await readdir(migrationDirectory))
    .filter((name) => /^\d{14}_[a-z0-9_]+\.sql$/.test(name))
    .sort()
  const migrations = []
  for (const name of migrationFiles) {
    migrations.push({
      name,
      sha256: sha256(await readFile(path.join(migrationDirectory, name))),
      version: name.slice(0, 14),
    })
  }

  const supabase = process.platform === 'win32' ? 'supabase.cmd' : 'supabase'
  const cliVersion = spawnSync(supabase, ['--version'], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  })
  if (
    cliVersion.status !== 0 ||
    cliVersion.stdout.trim() !== SUPABASE_CLI_VERSION
  ) {
    fail(`Supabase CLI ${SUPABASE_CLI_VERSION} is required`)
  }
  const psql = process.platform === 'win32' ? 'psql.exe' : 'psql'
  const psqlVersion = spawnSync(psql, ['--version'], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  })
  if (psqlVersion.status !== 0) fail('psql is unavailable')

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const paths = {
    roles: path.join(outputDirectory, `capital-lab-${timestamp}-roles.sql`),
    schema: path.join(outputDirectory, `capital-lab-${timestamp}-schema.sql`),
    data: path.join(outputDirectory, `capital-lab-${timestamp}-data.sql`),
    manifest: path.join(
      outputDirectory,
      `capital-lab-${timestamp}-manifest.json`,
    ),
  }
  const evidenceSql = buildCriticalEvidenceSql(contract)
  const evidenceBefore = await psqlEvidence(
    psql,
    sourceConnection.libpqEnv,
    evidenceSql,
  )
  const sourceIdentityBefore = await psqlEvidence(
    psql,
    sourceConnection.libpqEnv,
    buildServerIdentitySql(),
  )
  const rolePolicyBefore = await psqlEvidence(
    psql,
    sourceConnection.libpqEnv,
    buildRolePolicySql(),
  )
  const dumpCommands = [
    [
      'db',
      'dump',
      '--db-url',
      databaseUrl,
      '--role-only',
      '--file',
      paths.roles,
    ],
    ['db', 'dump', '--db-url', databaseUrl, '--file', paths.schema],
    [
      'db',
      'dump',
      '--db-url',
      databaseUrl,
      '--data-only',
      '--use-copy',
      '--file',
      paths.data,
    ],
  ]
  for (const args of dumpCommands) {
    const result = await spawnBounded(supabase, args)
    if (result.code !== 0 || result.signal)
      fail('Supabase database dump failed')
  }
  const evidenceAfter = await psqlEvidence(
    psql,
    sourceConnection.libpqEnv,
    evidenceSql,
  )
  const sourceIdentityAfter = await psqlEvidence(
    psql,
    sourceConnection.libpqEnv,
    buildServerIdentitySql(),
  )
  const rolePolicyAfter = await psqlEvidence(
    psql,
    sourceConnection.libpqEnv,
    buildRolePolicySql(),
  )
  if (
    evidenceBefore.databaseFingerprint !== evidenceAfter.databaseFingerprint ||
    canonicalJson(evidenceBefore) !== canonicalJson(evidenceAfter) ||
    canonicalJson(sourceIdentityBefore) !==
      canonicalJson(sourceIdentityAfter) ||
    canonicalJson(rolePolicyBefore) !== canonicalJson(rolePolicyAfter)
  ) {
    fail('Backup source changed or database identity switched during export')
  }
  const artifacts = {}
  for (const key of ['roles', 'schema', 'data']) {
    artifacts[key] = {
      file: path.basename(paths[key]),
      sha256: sha256(await readFile(paths[key])),
    }
  }
  const manifest = {
    artifacts,
    createdAt: new Date().toISOString(),
    gitCommitSha: commitSha,
    migrations,
    relationContractSha256,
    restorePreludeSha256,
    relations: evidenceBefore.relations,
    schemaContractVersion: 'capital-lab-activation-backup-v2',
    schemaVersion: 2,
    source: {
      appliedMigrations: evidenceBefore.appliedMigrations,
      databaseFingerprint: evidenceBefore.databaseFingerprint,
      rolePolicyFingerprint: fingerprintRolePolicy(rolePolicyBefore),
      serverVersion: evidenceBefore.serverVersion,
      serverFingerprint: sha256(sourceIdentityBefore.serverIdentity),
    },
    toolVersions: {
      psql: psqlVersion.stdout.trim(),
      supabase: SUPABASE_CLI_VERSION,
    },
  }
  await writeFile(paths.manifest, `${canonicalJson(manifest)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  process.stdout.write(
    `${JSON.stringify({ status: 'sensitive_backup_created', manifest: paths.manifest })}\n`,
  )
}

await main()
