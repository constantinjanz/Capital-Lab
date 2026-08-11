import { spawn, spawnSync } from 'node:child_process'
import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'

import {
  BACKUP_ARTIFACT_KEYS,
  assertBackupManifest,
  assertContractKeys,
  assertRestoredEvidence,
  buildCriticalEvidenceSql,
  buildRolePolicySql,
  buildServerIdentitySql,
  canonicalJson,
  criticalRelationSchemas,
  fingerprintRolePolicy,
  loadCriticalRelationContract,
  postgresUrlToLibpqEnv,
  redactedPostgresError,
  roleRestoreRequired,
  sha256,
} from './critical-backup-contract.mjs'
import {
  resolvedArguments,
  resolveNativeExecutable,
} from './lib/safe-process.mjs'

const PROCESS_TIMEOUT_MS = 600_000
const DISPOSABLE_CONFIRMATION = 'seed-free-disposable-database-confirmed'
const RESTORE_DATABASE = 'capital_lab_restore'

function options() {
  const entries = process.argv.slice(2).map((argument) => {
    const match = /^--(contract|expected-manifest-sha256|manifest)=(.+)$/u.exec(
      argument,
    )
    if (!match) throw new Error('Restore arguments are invalid')
    return [match[1], match[2]]
  })
  const parsed = Object.fromEntries(entries)
  if (
    entries.length !== 3 ||
    new Set(entries.map(([key]) => key)).size !== 3 ||
    !['pre', 'post'].includes(parsed.contract) ||
    !/^[0-9a-f]{64}$/u.test(parsed['expected-manifest-sha256'] ?? '')
  ) {
    throw new Error(
      'Required: --contract=pre|post --manifest=<external> --expected-manifest-sha256=<external-hash>',
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
  if (result.status !== 0 || result.signal || result.error)
    throw new Error('Git evidence could not be derived')
  return result.stdout.trim()
}

async function runPsql(connectionEnv, args, input) {
  const executable = resolveNativeExecutable('psql')
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    const child = spawn(
      executable.command,
      resolvedArguments(executable, [
        '-X',
        '--no-psqlrc',
        '--set',
        'ON_ERROR_STOP=1',
        ...args,
      ]),
      {
        env: {
          ...process.env,
          ...connectionEnv,
          PGCONNECT_TIMEOUT: '10',
          PGOPTIONS: '-c statement_timeout=300000 -c lock_timeout=10000',
        },
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
            `psql restore or evidence step failed; redacted database error: ${redactedPostgresError(stderr)}`,
          ),
        )
      } else resolve(stdout)
    })
    child.stdin.end(input)
  })
}

async function evidence(connectionEnv, sql) {
  const output = await runPsql(
    connectionEnv,
    ['--tuples-only', '--no-align'],
    sql,
  )
  return JSON.parse(output.trim())
}

async function main() {
  const requested = options()
  if (
    process.env.CAPITAL_LAB_RESTORE_CONFIRM_DISPOSABLE !==
    DISPOSABLE_CONFIRMATION
  ) {
    throw new Error(
      'Explicit seed-free disposable-database confirmation is required',
    )
  }
  const restoreValue = process.env.CAPITAL_LAB_RESTORE_DATABASE_URL
  const sourceValue = process.env.CAPITAL_LAB_DATABASE_URL
  if (!restoreValue || !sourceValue)
    throw new Error(
      'Local source and restore database URLs are required and never printed',
    )
  const restoreConnection = postgresUrlToLibpqEnv(restoreValue, {
    localOnly: true,
  })
  const sourceConnection = postgresUrlToLibpqEnv(sourceValue, {
    localOnly: true,
  })
  if (
    restoreConnection.database !== RESTORE_DATABASE ||
    sourceConnection.database !== 'postgres' ||
    restoreConnection.hostname !== sourceConnection.hostname ||
    restoreConnection.port !== sourceConnection.port
  ) {
    throw new Error(
      'Restore target is not the exact disposable database on the local source instance',
    )
  }
  const workspace = await realpath(process.cwd())
  if (git(['status', '--porcelain=v1', '--untracked-files=all'], workspace)) {
    throw new Error(
      'Restore verification requires a completely clean Working Tree',
    )
  }
  const commitSha = git(['rev-parse', 'HEAD'], workspace)
  const manifestPath = await realpath(path.resolve(requested.manifest))
  const manifestDirectory = path.dirname(manifestPath)
  const manifestBytes = await readFile(manifestPath)
  if (sha256(manifestBytes) !== requested['expected-manifest-sha256']) {
    throw new Error(
      'Backup manifest differs from the externally retained SHA-256',
    )
  }
  const manifest = JSON.parse(manifestBytes.toString('utf8'))
  if (manifestBytes.toString('utf8') !== `${canonicalJson(manifest)}\n`) {
    throw new Error('Backup manifest is not canonical JSON')
  }
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
  const restorePreludePath = path.join(
    workspace,
    'supabase',
    'backup',
    'seed-free-target-prelude.sql',
  )
  const restorePreludeSha256 = sha256(await readFile(restorePreludePath))
  const relationSetSha256 = sha256(
    contract.relations.map((spec) => spec.relation).join('\n'),
  )
  assertBackupManifest(manifest, {
    contractKind,
    dataSchemas,
    gitCommitSha: commitSha,
    migrations: contract.migrations,
    relationContractSha256,
    relationNames: contract.relations.map((spec) => spec.relation),
    relationSetSha256,
    restorePreludeSha256,
  })
  const artifactFiles = BACKUP_ARTIFACT_KEYS.map(
    (key) => manifest.artifacts[key].file,
  )
  if (new Set(artifactFiles).size !== artifactFiles.length) {
    throw new Error('Backup manifest contains duplicate artifact paths')
  }
  const artifacts = {}
  for (const key of BACKUP_ARTIFACT_KEYS) {
    const metadata = manifest.artifacts[key]
    const artifact = await realpath(path.join(manifestDirectory, metadata.file))
    if (path.dirname(artifact) !== manifestDirectory)
      throw new Error('Backup artifact escaped its directory')
    if (sha256(await readFile(artifact)) !== metadata.sha256)
      throw new Error('Backup artifact checksum mismatch')
    artifacts[key] = artifact
  }
  const sourceIdentity = await evidence(
    sourceConnection.libpqEnv,
    buildServerIdentitySql(),
  )
  const preflight = await evidence(
    restoreConnection.libpqEnv,
    `select jsonb_build_object(
      'userRelations', count(*) filter (where namespace.nspname in ('public','private','supabase_migrations')),
      'serverIdentity', current_setting('server_version_num') || ':' || max(control.system_identifier)::text,
      'databaseIdentity', max(database.oid)::text || ':' || current_database() || ':'
        || current_setting('server_version_num') || ':' || max(control.system_identifier)::text
    ) from pg_catalog.pg_class as class
    join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
    cross join pg_catalog.pg_control_system() as control
    cross join pg_catalog.pg_database as database
    where class.relkind in ('r','p') and database.datname = current_database();\n`,
  )
  if (
    preflight.userRelations !== 0 ||
    sha256(preflight.serverIdentity) !==
      sha256(sourceIdentity.serverIdentity) ||
    sha256(preflight.databaseIdentity) === manifest.source.databaseFingerprint
  ) {
    throw new Error(
      'Restore target is not an empty disposable database on the source local instance',
    )
  }
  const targetRolePolicy = fingerprintRolePolicy(
    await evidence(restoreConnection.libpqEnv, buildRolePolicySql()),
  )
  if (
    roleRestoreRequired(
      manifest.source.rolePolicyFingerprint,
      targetRolePolicy,
      true,
    )
  ) {
    await runPsql(restoreConnection.libpqEnv, ['--file', artifacts.roles])
  }
  await runPsql(restoreConnection.libpqEnv, [
    '--single-transaction',
    '--file',
    restorePreludePath,
  ])
  await runPsql(restoreConnection.libpqEnv, [
    '--single-transaction',
    '--file',
    artifacts.schema,
  ])
  await runPsql(restoreConnection.libpqEnv, [
    '--single-transaction',
    '--command',
    'SET session_replication_role = replica',
    '--file',
    artifacts.data,
  ])
  await runPsql(restoreConnection.libpqEnv, [
    '--single-transaction',
    '--file',
    artifacts.historySchema,
    '--file',
    artifacts.historyData,
  ])
  const actualEvidence = await evidence(
    restoreConnection.libpqEnv,
    buildCriticalEvidenceSql(contract),
  )
  assertContractKeys(contract, actualEvidence)
  assertRestoredEvidence(manifest, actualEvidence)
  if (
    actualEvidence.databaseFingerprint === manifest.source.databaseFingerprint
  ) {
    throw new Error(
      'Disposable restore unexpectedly reused the source database identity',
    )
  }
  process.stdout.write(
    `${JSON.stringify({ status: 'seed_free_disposable_restore_verified', contractKind, relationCount: contract.relations.length, manifestSha256: requested['expected-manifest-sha256'] })}\n`,
  )
}

await main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.message
      : 'Restore verification failed closed',
  )
  process.exit(1)
})
