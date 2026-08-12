import { spawn, spawnSync } from 'node:child_process'
import {
  chmod,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'

import {
  BACKUP_ARTIFACT_KEYS,
  assertContractKeys,
  buildAuthEvidenceSql,
  buildCriticalEvidenceSql,
  buildRolePolicySql,
  buildServerIdentitySql,
  canonicalJson,
  criticalRelationSchemas,
  filterApplicationSchemaArchiveToc,
  fingerprintRolePolicy,
  loadCriticalRelationContract,
  loadSchemaGolden,
  postgresUrlToLibpqEnv,
  redactedPostgresError,
  sha256,
} from './critical-backup-contract.mjs'
import { canonicalRepositoryTextBytes } from './lib/canonical-repository-bytes.mjs'
import {
  resolvedArguments,
  resolveNativeExecutable,
} from './lib/safe-process.mjs'
import {
  newExternalPath,
  verifyCreatedExternalPath,
} from './lib/safe-artifact-path.mjs'

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

function snapshotSql(sql, snapshot) {
  if (!/^[0-9A-Fa-f-]{8,128}$/u.test(snapshot)) {
    throw new Error('Exported PostgreSQL snapshot identity is invalid')
  }
  return `\\set ON_ERROR_STOP on
begin isolation level repeatable read read only;
set transaction snapshot '${snapshot}';
${sql}
commit;
`
}

async function evidence(connectionEnv, sql, snapshot) {
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
    snapshot ? snapshotSql(sql, snapshot) : sql,
  )
  return JSON.parse(result.stdout.trim())
}

async function withExportedSnapshot(connectionEnv, callback) {
  const executable = resolveNativeExecutable('psql')
  const child = spawn(
    executable.command,
    resolvedArguments(executable, [
      '-X',
      '--no-psqlrc',
      '--quiet',
      '--tuples-only',
      '--no-align',
      '--set',
      'ON_ERROR_STOP=1',
    ]),
    {
      env: {
        ...process.env,
        ...connectionEnv,
        PGCONNECT_TIMEOUT: '10',
        PGOPTIONS: '-c statement_timeout=600000 -c lock_timeout=10000',
      },
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )
  let stdout = ''
  let stderr = ''
  let settled = false
  let timedOut = false
  let resolveSnapshot
  let rejectSnapshot
  const snapshotReady = new Promise((resolve, reject) => {
    resolveSnapshot = resolve
    rejectSnapshot = reject
  })
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString()
    const snapshot = stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find((line) => /^[0-9A-Fa-f-]{8,128}$/u.test(line))
    if (snapshot) resolveSnapshot(snapshot)
  })
  child.stderr.on('data', (chunk) => (stderr += chunk.toString()))
  const exit = new Promise((resolve, reject) => {
    child.once('error', (error) => {
      if (settled) return
      settled = true
      rejectSnapshot(error)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      if (settled) return
      settled = true
      if (code !== 0 || signal || timedOut) {
        const error = new Error(
          `PostgreSQL snapshot holder failed; redacted database error: ${redactedPostgresError(stderr)}`,
        )
        rejectSnapshot(error)
        reject(error)
      } else resolve()
    })
  })
  const timer = setTimeout(() => {
    timedOut = true
    child.kill('SIGTERM')
  }, PROCESS_TIMEOUT_MS)
  child.stdin.write(
    'begin isolation level repeatable read read only;\nselect pg_export_snapshot();\n',
  )
  try {
    const snapshot = await snapshotReady
    return await callback(snapshot)
  } finally {
    if (!child.stdin.destroyed) child.stdin.end('rollback;\n')
    try {
      await exit
    } finally {
      clearTimeout(timer)
    }
  }
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

async function injectFixedLocalMvccRace(connection) {
  if (process.env.CAPITAL_LAB_LOCAL_MVCC_RACE !== 'application-setting-v1') {
    return false
  }
  if (!['127.0.0.1', 'localhost', '::1'].includes(connection.hostname)) {
    throw new Error('MVCC race fixture is restricted to a local source')
  }
  await run(
    'psql',
    ['-X', '--no-psqlrc', '--set', 'ON_ERROR_STOP=1'],
    {
      ...process.env,
      ...connection.libpqEnv,
      PGCONNECT_TIMEOUT: '10',
      PGOPTIONS: '-c statement_timeout=30000 -c lock_timeout=10000',
    },
    `insert into private.application_settings (owner_id, setting_key, value, is_secret)
select user_id, 'local_mvcc_race_fixture_v1', 'false'::jsonb, false
from public.app_users order by user_id limit 1;
`,
  )
  return true
}

async function cleanupFixedLocalMvccRace(connection) {
  await run(
    'psql',
    ['-X', '--no-psqlrc', '--set', 'ON_ERROR_STOP=1'],
    {
      ...process.env,
      ...connection.libpqEnv,
      PGCONNECT_TIMEOUT: '10',
      PGOPTIONS: '-c statement_timeout=30000 -c lock_timeout=10000',
    },
    `delete from private.application_settings
where setting_key = 'local_mvcc_race_fixture_v1';
`,
  )
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
  const outputPath = await newExternalPath(workspace, requested['output-dir'])
  await mkdir(outputPath, { recursive: false, mode: 0o700 })
  await verifyCreatedExternalPath(workspace, outputPath)
  let completed = false
  let raceCleanupConnection = null
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
    const goldenPath = path.join(
      workspace,
      'supabase',
      'backup',
      requested.contract === 'pre'
        ? 'pre-activation.schema-golden.v2.json'
        : 'post-activation.schema-golden.v2.json',
    )
    const { golden, sha256: schemaGoldenSha256 } = await loadSchemaGolden(
      goldenPath,
      contractKind,
      relationContractSha256,
    )
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
    const pgRestoreVersion = await toolVersion('pg_restore')
    const identityBefore = await evidence(
      connection.libpqEnv,
      buildServerIdentitySql(),
    )
    const rolePolicyBefore = await evidence(
      connection.libpqEnv,
      buildRolePolicySql(),
    )
    const paths = {
      roles: path.join(outputPath, 'roles.sql'),
      authSchema: path.join(outputPath, 'auth-schema.sql'),
      authData: path.join(outputPath, 'auth-data.sql'),
      schema: path.join(outputPath, 'schema.sql'),
      data: path.join(outputPath, 'data.sql'),
      historySchema: path.join(outputPath, 'migration-history-schema.sql'),
      historyData: path.join(outputPath, 'migration-history-data.sql'),
      manifest: path.join(outputPath, 'manifest.json'),
    }
    const schemaArchive = path.join(outputPath, '.application-schema.dump')
    const schemaToc = path.join(outputPath, '.application-schema.toc')
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
    const evidenceSql = buildCriticalEvidenceSql(contract)
    let evidenceBefore
    let authEvidence
    let filteredToc
    let mvccRaceFixtureEnabled = false
    await withExportedSnapshot(connection.libpqEnv, async (snapshot) => {
      evidenceBefore = await evidence(
        connection.libpqEnv,
        evidenceSql,
        snapshot,
      )
      authEvidence = await evidence(
        connection.libpqEnv,
        buildAuthEvidenceSql(),
        snapshot,
      )
      assertContractKeys(contract, evidenceBefore)
      if (
        canonicalJson(evidenceBefore.appliedMigrations) !==
          canonicalJson(
            contract.migrations.map(({ name, version }) => ({
              name: name.slice(15, -4),
              version,
            })),
          ) ||
        evidenceBefore.schemaFingerprintSha256 !==
          golden.schemaFingerprintSha256 ||
        canonicalJson(evidenceBefore.schemaEvidence) !==
          canonicalJson(golden.schemaEvidence) ||
        sha256(canonicalJson(evidenceBefore.schemaEvidence)) !==
          golden.schemaEvidenceSha256 ||
        evidenceBefore.relationSetSha256 !== golden.relationSetSha256 ||
        evidenceBefore.migrationHistorySha256 !== golden.migrationHistorySha256
      ) {
        throw new Error(
          'Source schema, migration history, or relation set differs from the committed golden',
        )
      }
      mvccRaceFixtureEnabled = await injectFixedLocalMvccRace(connection)
      if (mvccRaceFixtureEnabled) raceCleanupConnection = connection
      const snapshotArgument = `--snapshot=${snapshot}`
      await run(
        'pg_dump',
        [
          snapshotArgument,
          '--schema-only',
          '--no-owner',
          '--schema',
          'auth',
          '--file',
          paths.authSchema,
        ],
        dumpEnv,
      )
      await run(
        'pg_dump',
        [
          snapshotArgument,
          '--data-only',
          '--no-owner',
          '--no-privileges',
          '--schema',
          'auth',
          '--file',
          paths.authData,
        ],
        dumpEnv,
      )
      await run(
        'pg_dump',
        [
          snapshotArgument,
          '--format=custom',
          '--schema-only',
          '--schema',
          'public',
          '--schema',
          'private',
          '--file',
          schemaArchive,
        ],
        dumpEnv,
      )
      await chmod(schemaArchive, 0o600)
      const archiveToc = await run(
        'pg_restore',
        ['--list', schemaArchive],
        dumpEnv,
      )
      filteredToc = filterApplicationSchemaArchiveToc(archiveToc.stdout)
      await writeFile(schemaToc, filteredToc.toc, {
        mode: 0o600,
        flag: 'wx',
      })
      await run(
        'pg_restore',
        [
          '--no-owner',
          '--use-list',
          schemaToc,
          '--file',
          paths.schema,
          schemaArchive,
        ],
        dumpEnv,
      )
      await rm(schemaArchive, { force: true })
      await rm(schemaToc, { force: true })
      for (const [file, schemas, schemaOnly] of [
        [paths.data, ['public', 'private'], false],
        [paths.historySchema, ['supabase_migrations'], true],
        [paths.historyData, ['supabase_migrations'], false],
      ]) {
        await run(
          'pg_dump',
          [
            snapshotArgument,
            schemaOnly ? '--schema-only' : '--data-only',
            '--no-owner',
            ...(schemaOnly ? [] : ['--no-privileges']),
            ...schemas.flatMap((schema) => ['--schema', schema]),
            '--file',
            file,
          ],
          dumpEnv,
        )
      }
    })
    if (raceCleanupConnection) {
      await cleanupFixedLocalMvccRace(raceCleanupConnection)
      raceCleanupConnection = null
    }
    for (const key of BACKUP_ARTIFACT_KEYS) await chmod(paths[key], 0o600)
    const identityAfter = await evidence(
      connection.libpqEnv,
      buildServerIdentitySql(),
    )
    const rolePolicyAfter = await evidence(
      connection.libpqEnv,
      buildRolePolicySql(),
    )
    const evidenceAfter = await evidence(connection.libpqEnv, evidenceSql)
    const authEvidenceAfter = await evidence(
      connection.libpqEnv,
      buildAuthEvidenceSql(),
    )
    if (
      canonicalJson(identityBefore) !== canonicalJson(identityAfter) ||
      canonicalJson(rolePolicyBefore) !== canonicalJson(rolePolicyAfter) ||
      canonicalJson(evidenceBefore) !== canonicalJson(evidenceAfter) ||
      canonicalJson(authEvidence) !== canonicalJson(authEvidenceAfter)
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
      authEvidence,
      contractKind,
      createdAt: new Date().toISOString(),
      dataSchemas,
      defaultAclPolicy: {
        applicationEntryCount: filteredToc.applicationCount,
        applicationOwner: 'postgres',
        platformExcludedEntryCount: filteredToc.platformCount,
        platformExcludedOwner: 'supabase_admin',
      },
      gitCommitSha: commitSha,
      migrations: contract.migrations,
      snapshotPolicy: {
        applicationAuthAndHistoryShareExportedSnapshot: true,
        isolation: 'repeatable read read only',
        rolePolicyComparedOutsideSnapshot: true,
        sourceStateReverifiedAfterExport: true,
        localRaceFixture: mvccRaceFixtureEnabled
          ? 'application-setting-v1'
          : null,
      },
      relationContractSha256,
      relationSetSha256: evidenceBefore.relationSetSha256,
      relations: evidenceBefore.relations,
      restorePreludeSha256,
      schemaContractVersion: `capital-lab-${contractKind}-backup-v6`,
      schemaEvidenceSha256: golden.schemaEvidenceSha256,
      schemaFingerprintSha256: evidenceBefore.schemaFingerprintSha256,
      schemaGoldenSha256,
      schemaVersion: 6,
      source: {
        appliedMigrations: evidenceBefore.appliedMigrations,
        databaseFingerprint: evidenceBefore.databaseFingerprint,
        rolePolicyFingerprint: fingerprintRolePolicy(rolePolicyBefore),
        schemaEvidenceSha256: golden.schemaEvidenceSha256,
        schemaFingerprintSha256: evidenceBefore.schemaFingerprintSha256,
        migrationHistorySha256: evidenceBefore.migrationHistorySha256,
        serverFingerprint: sha256(identityBefore.serverIdentity),
        serverVersion: evidenceBefore.serverVersion,
      },
      toolVersions: {
        pgDump: pgDumpVersion,
        pgDumpall: pgDumpallVersion,
        pgRestore: pgRestoreVersion,
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
    try {
      if (raceCleanupConnection) {
        await cleanupFixedLocalMvccRace(raceCleanupConnection)
      }
    } finally {
      if (!completed) await rm(outputPath, { recursive: true, force: true })
    }
  }
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Backup failed closed')
  process.exit(1)
})
