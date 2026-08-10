import { spawn, spawnSync } from 'node:child_process'
import { readFile, realpath, readdir } from 'node:fs/promises'
import path from 'node:path'

import {
  BACKUP_ARTIFACT_KEYS,
  assertBackupManifest,
  assertRestoredEvidence,
  buildCriticalEvidenceSql,
  buildRolePolicySql,
  canonicalJson,
  fingerprintRolePolicy,
  loadCriticalRelationContract,
  postgresUrlToLibpqEnv,
  redactedPostgresError,
  sha256,
} from './critical-backup-contract.mjs'

const PROCESS_TIMEOUT_MS = 600_000
const DISPOSABLE_CONFIRMATION = 'seed-free-disposable-database-confirmed'

function fail(message) {
  throw new Error(message)
}

function exactOption(name) {
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

async function runPsql(psql, connectionEnv, args, input = undefined) {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    const child = spawn(
      psql,
      ['-X', '--no-psqlrc', '--set', 'ON_ERROR_STOP=1', ...args],
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
    child.once('error', reject)
    const timer = setTimeout(() => child.kill('SIGTERM'), PROCESS_TIMEOUT_MS)
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      if (code !== 0 || signal) {
        reject(
          new Error(
            `psql restore or evidence step failed; redacted database error: ${redactedPostgresError(stderr)}`,
          ),
        )
      } else resolve(stdout)
    })
    if (input === undefined) child.stdin.end()
    else child.stdin.end(input)
  })
}

async function repositoryMigrations(workspace) {
  const directory = path.join(workspace, 'supabase', 'migrations')
  const names = (await readdir(directory))
    .filter((name) => /^\d{14}_[a-z0-9_]+\.sql$/.test(name))
    .sort()
  return Promise.all(
    names.map(async (name) => ({
      name,
      sha256: sha256(await readFile(path.join(directory, name))),
      version: name.slice(0, 14),
    })),
  )
}

async function main() {
  const manifestInput = exactOption('manifest')
  if (!manifestInput) {
    fail('Usage: pnpm backup:restore:test -- --manifest=<external-manifest>')
  }
  if (
    process.env.CAPITAL_LAB_RESTORE_CONFIRM_DISPOSABLE !==
    DISPOSABLE_CONFIRMATION
  ) {
    fail('Explicit seed-free disposable-database confirmation is required')
  }
  const databaseValue = process.env.CAPITAL_LAB_RESTORE_DATABASE_URL
  if (!databaseValue)
    fail('CAPITAL_LAB_RESTORE_DATABASE_URL is required and never printed')
  const restoreConnection = postgresUrlToLibpqEnv(databaseValue, {
    localOnly: true,
  })

  const workspace = await realpath(process.cwd())
  if (git(['status', '--porcelain=v1', '--untracked-files=all'], workspace)) {
    fail('Restore verification requires a completely clean Working Tree')
  }
  const commitSha = git(['rev-parse', 'HEAD'], workspace)
  const manifestPath = await realpath(path.resolve(manifestInput))
  const manifestDirectory = path.dirname(manifestPath)
  const manifestBytes = await readFile(manifestPath)
  const manifest = JSON.parse(manifestBytes.toString('utf8'))
  if (manifestBytes.toString('utf8') !== `${canonicalJson(manifest)}\n`) {
    fail('Backup manifest is not canonical JSON')
  }
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
  const migrations = await repositoryMigrations(workspace)
  assertBackupManifest(manifest, {
    gitCommitSha: commitSha,
    migrations,
    relationContractSha256,
    relationNames: contract.relations.map((spec) => spec.relation),
    restorePreludeSha256,
  })

  const artifacts = {}
  for (const key of BACKUP_ARTIFACT_KEYS) {
    const metadata = manifest.artifacts?.[key]
    if (
      !metadata ||
      !/^[a-zA-Z0-9._-]+\.sql$/.test(metadata.file) ||
      !/^[0-9a-f]{64}$/.test(metadata.sha256)
    ) {
      fail('Backup artifact manifest is invalid')
    }
    const artifact = await realpath(path.join(manifestDirectory, metadata.file))
    if (path.dirname(artifact) !== manifestDirectory)
      fail('Backup artifact escaped its directory')
    if (sha256(await readFile(artifact)) !== metadata.sha256) {
      fail('Backup artifact checksum mismatch')
    }
    artifacts[key] = artifact
  }

  const psql = process.platform === 'win32' ? 'psql.exe' : 'psql'
  const psqlVersion = spawnSync(psql, ['--version'], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  })
  if (
    psqlVersion.status !== 0 ||
    psqlVersion.stdout.trim() !== manifest.toolVersions.psql
  ) {
    fail('Restore psql version differs from the backup manifest')
  }
  const preflight = await runPsql(
    psql,
    restoreConnection.libpqEnv,
    ['--tuples-only', '--no-align'],
    `select jsonb_build_object(
      'user_relations', count(*) filter (where namespace.nspname in ('public','private','supabase_migrations')),
      'managed_baseline', to_regclass('auth.users') is not null
        and to_regprocedure('auth.uid()') is not null
        and to_regclass('storage.buckets') is not null
        and to_regnamespace('extensions') is not null
        and to_regclass('vault.secrets') is not null,
      'database_identity', max(database.oid)::text || ':' || current_database() || ':'
        || current_setting('server_version_num') || ':' || max(control.system_identifier)::text,
      'server_identity', current_setting('server_version_num')
        || ':' || max(control.system_identifier)::text
    )
    from pg_catalog.pg_class as class
    join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
    cross join pg_catalog.pg_control_system() as control
    cross join pg_catalog.pg_database as database
    where class.relkind in ('r','p')
      and database.datname = current_database();\n`,
  )
  const preflightEvidence = JSON.parse(preflight.trim())
  if (preflightEvidence.user_relations !== 0) {
    fail('Restore target is not an empty seed-free disposable database')
  }
  if (preflightEvidence.managed_baseline !== true) {
    fail('Restore target is not a provisioned Supabase baseline')
  }
  if (
    sha256(preflightEvidence.database_identity) ===
    manifest.source.databaseFingerprint
  ) {
    fail('Restore target fingerprint equals the source database')
  }

  const rolePolicyOutput = await runPsql(
    psql,
    restoreConnection.libpqEnv,
    ['--tuples-only', '--no-align'],
    buildRolePolicySql(),
  )
  const targetRolePolicyFingerprint = fingerprintRolePolicy(
    JSON.parse(rolePolicyOutput.trim()),
  )
  const sameServer =
    sha256(preflightEvidence.server_identity) ===
    manifest.source.serverFingerprint
  if (sameServer) {
    if (targetRolePolicyFingerprint !== manifest.source.rolePolicyFingerprint) {
      fail('Same-server disposable target role policy differs from the source')
    }
  } else {
    await runPsql(psql, restoreConnection.libpqEnv, ['--file', artifacts.roles])
    const restoredRolePolicyOutput = await runPsql(
      psql,
      restoreConnection.libpqEnv,
      ['--tuples-only', '--no-align'],
      buildRolePolicySql(),
    )
    if (
      fingerprintRolePolicy(JSON.parse(restoredRolePolicyOutput.trim())) !==
      manifest.source.rolePolicyFingerprint
    ) {
      fail('Restored database role policy differs from the backup manifest')
    }
  }

  await runPsql(psql, restoreConnection.libpqEnv, [
    '--single-transaction',
    '--file',
    restorePreludePath,
  ])
  await runPsql(psql, restoreConnection.libpqEnv, [
    '--single-transaction',
    '--file',
    artifacts.schema,
  ])
  await runPsql(psql, restoreConnection.libpqEnv, [
    '--single-transaction',
    '--command',
    'SET session_replication_role = replica',
    '--file',
    artifacts.data,
  ])
  await runPsql(psql, restoreConnection.libpqEnv, [
    '--single-transaction',
    '--file',
    artifacts.historySchema,
    '--file',
    artifacts.historyData,
  ])
  const evidenceOutput = await runPsql(
    psql,
    restoreConnection.libpqEnv,
    ['--tuples-only', '--no-align'],
    buildCriticalEvidenceSql(contract),
  )
  const actualEvidence = JSON.parse(evidenceOutput.trim())
  assertRestoredEvidence(manifest, actualEvidence)
  if (
    actualEvidence.databaseFingerprint === manifest.source.databaseFingerprint
  ) {
    fail('Disposable restore unexpectedly reused the source database identity')
  }
  process.stdout.write(
    `${JSON.stringify({ status: 'seed_free_disposable_restore_verified', relationCount: contract.relations.length })}\n`,
  )
}

await main()
