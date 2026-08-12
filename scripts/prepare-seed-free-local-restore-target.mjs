import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, readFile, realpath, writeFile } from 'node:fs/promises'

import {
  buildServerIdentitySql,
  canonicalJson,
  postgresUrlToLibpqEnv,
  redactedPostgresError,
  sha256,
} from './critical-backup-contract.mjs'
import {
  buildRestoreTargetProof,
  canonicalJson as canonicalProofJson,
  restoreProjectId,
  validateRestoreContainerInspection,
} from './lib/local-supabase-target-proof.mjs'
import {
  resolvedArguments,
  resolveNativeExecutable,
} from './lib/safe-process.mjs'
import {
  newExternalPath,
  verifiedExternalFile,
} from './lib/safe-artifact-path.mjs'

const PROCESS_TIMEOUT_MS = 300_000
const DISPOSABLE_CONFIRMATION =
  'RESET DISPOSABLE CAPITAL LAB RESTORE STACK B postgres'

function options() {
  if (process.argv.length !== 3) {
    throw new Error('Required: --proof=<new-external-proof-file>')
  }
  const match = /^--proof=(.+)$/u.exec(process.argv[2])
  if (!match) throw new Error('Restore-target proof argument is invalid')
  return { proof: match[1] }
}

function git(args, cwd) {
  const executable = resolveNativeExecutable('git')
  const result = spawnSync(
    executable.command,
    resolvedArguments(executable, args),
    { cwd, encoding: 'utf8', shell: false, windowsHide: true },
  )
  if (result.status !== 0 || result.signal || result.error) {
    throw new Error('Git evidence could not be derived')
  }
  return result.stdout.trim()
}

async function run(name, args, env, input, capture = false) {
  const executable = resolveNativeExecutable(name)
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
        stdio: ['pipe', capture ? 'pipe' : 'ignore', 'pipe'],
      },
    )
    child.stdout?.on('data', (chunk) => (stdout += chunk.toString()))
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
            `Disposable target preparation failed; redacted error: ${redactedPostgresError(stderr)}`,
          ),
        )
      } else resolve(stdout)
    })
    child.stdin.end(input)
  })
}

async function databaseEvidence(connection, sql) {
  const output = await run(
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
      ...connection.libpqEnv,
      PGCONNECT_TIMEOUT: '10',
      PGOPTIONS: '-c statement_timeout=300000 -c lock_timeout=10000',
    },
    sql,
    true,
  )
  return JSON.parse(output.trim())
}

async function inspectRestoreContainer(runId) {
  const projectId = restoreProjectId(runId)
  const output = await run(
    'docker',
    ['inspect', `supabase_db_${projectId}`],
    process.env,
    undefined,
    true,
  )
  const parsed = JSON.parse(output)
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new Error('Disposable Supabase stack B container is not unique')
  }
  return parsed[0]
}

async function main() {
  const requested = options()
  if (
    process.env.CAPITAL_LAB_LOCAL_DISPOSABLE_CONFIRM !== DISPOSABLE_CONFIRMATION
  ) {
    throw new Error('Exact disposable stack B confirmation is required')
  }
  const workspace = await realpath(process.cwd())
  const runId = process.env.CAPITAL_LAB_RESTORE_RUN_ID
  const disposableMarker = process.env.CAPITAL_LAB_RESTORE_DISPOSABLE_MARKER
  if (
    !/^[a-z0-9][a-z0-9-]{5,31}$/u.test(runId ?? '') ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      disposableMarker ?? '',
    )
  ) {
    throw new Error('Run-specific disposable target identity is required')
  }
  if (git(['status', '--porcelain=v1', '--untracked-files=all'], workspace)) {
    throw new Error('Restore-target preparation requires a clean Working Tree')
  }
  const proofPath = await newExternalPath(workspace, requested.proof)
  const sourceValue = process.env.CAPITAL_LAB_DATABASE_URL
  const targetValue = process.env.CAPITAL_LAB_RESTORE_DATABASE_URL
  if (!sourceValue || !targetValue) {
    throw new Error(
      'Source and target database URLs are required and never printed',
    )
  }
  const source = postgresUrlToLibpqEnv(sourceValue, { localOnly: true })
  const target = postgresUrlToLibpqEnv(targetValue, { localOnly: true })
  if (
    source.hostname !== '127.0.0.1' ||
    source.port !== '54322' ||
    source.database !== 'postgres' ||
    target.hostname !== '127.0.0.1' ||
    target.port !== '55322' ||
    target.database !== 'postgres'
  ) {
    throw new Error('Source A or disposable target B boundary is invalid')
  }
  const inspection = await inspectRestoreContainer(runId)
  const containerIdentity = validateRestoreContainerInspection(
    inspection,
    runId,
  )
  if (
    containerIdentity.hostname !== target.hostname ||
    containerIdentity.port !== target.port ||
    containerIdentity.database !== target.database
  ) {
    throw new Error('Disposable container differs from the target URL')
  }
  const sourceIdentity = await databaseEvidence(
    source,
    buildServerIdentitySql(),
  )
  const targetIdentity = await databaseEvidence(
    target,
    buildServerIdentitySql(),
  )
  if (
    sourceIdentity.serverIdentity === targetIdentity.serverIdentity ||
    targetIdentity.databaseRole !== 'postgres'
  ) {
    throw new Error(
      'Source A and target B do not have distinct PostgreSQL system identifiers',
    )
  }
  const runIdLiteral = runId.replaceAll("'", "''")
  const markerLiteral = disposableMarker.replaceAll("'", "''")
  await run(
    'psql',
    ['-X', '--no-psqlrc', '--set', 'ON_ERROR_STOP=1'],
    {
      ...process.env,
      ...target.libpqEnv,
      PGCONNECT_TIMEOUT: '10',
      PGOPTIONS: '-c statement_timeout=300000 -c lock_timeout=10000',
    },
    `begin;
create schema capital_lab_restore authorization postgres;
create table capital_lab_restore.run_identity (
  singleton boolean primary key default true check (singleton),
  run_id text not null unique,
  disposable_marker uuid not null unique,
  created_at timestamptz not null default statement_timestamp()
);
insert into capital_lab_restore.run_identity (run_id, disposable_marker)
values ('${runIdLiteral}', '${markerLiteral}'::uuid);
revoke all on schema capital_lab_restore from public;
revoke all on all tables in schema capital_lab_restore from public, anon, authenticated, service_role;
commit;
`,
  )
  const markerEvidence = await databaseEvidence(
    target,
    `select jsonb_build_object(
      'database', current_database(), 'databaseRole', current_user,
      'runId', marker.run_id, 'disposableMarker', marker.disposable_marker::text
    ) from capital_lab_restore.run_identity as marker where marker.singleton;`,
  )
  if (
    markerEvidence.runId !== runId ||
    markerEvidence.disposableMarker !== disposableMarker ||
    markerEvidence.database !== 'postgres' ||
    markerEvidence.databaseRole !== 'postgres'
  ) {
    throw new Error('Disposable target marker evidence differs')
  }
  const preparedAt = new Date().toISOString()
  const proofBinding = {
    disposableMarker,
    markerEvidenceSha256: sha256(canonicalJson(markerEvidence)),
    runId,
    sourceServerFingerprint: sha256(sourceIdentity.serverIdentity),
  }
  const proof = buildRestoreTargetProof(
    inspection,
    targetIdentity,
    proofBinding,
    preparedAt,
  )
  if (
    proof.hostname !== target.hostname ||
    proof.port !== target.port ||
    proof.database !== target.database ||
    proof.disposableMarker !== disposableMarker ||
    proof.runId !== runId
  ) {
    throw new Error('Destructive target proof differs before reset')
  }
  await run(
    'psql',
    ['-X', '--no-psqlrc', '--set', 'ON_ERROR_STOP=1'],
    {
      ...process.env,
      ...target.libpqEnv,
      PGCONNECT_TIMEOUT: '10',
      PGOPTIONS: '-c statement_timeout=300000 -c lock_timeout=10000',
    },
    `begin;
drop schema if exists private cascade;
drop schema if exists public cascade;
drop schema if exists supabase_migrations cascade;
drop schema if exists auth cascade;
create schema public authorization postgres;
commit;
`,
  )
  const postResetIdentity = await databaseEvidence(
    target,
    buildServerIdentitySql(),
  )
  const postResetMarkerEvidence = await databaseEvidence(
    target,
    `select jsonb_build_object(
      'database', current_database(), 'databaseRole', current_user,
      'runId', marker.run_id, 'disposableMarker', marker.disposable_marker::text
    ) from capital_lab_restore.run_identity as marker where marker.singleton;`,
  )
  if (canonicalJson(targetIdentity) !== canonicalJson(postResetIdentity)) {
    throw new Error('Target B database identity changed during preparation')
  }
  if (
    canonicalJson(markerEvidence) !== canonicalJson(postResetMarkerEvidence)
  ) {
    throw new Error('Disposable target marker changed during preparation')
  }
  const postResetInspection = await inspectRestoreContainer(runId)
  const postResetProof = buildRestoreTargetProof(
    postResetInspection,
    postResetIdentity,
    proofBinding,
    preparedAt,
  )
  if (canonicalProofJson(proof) !== canonicalProofJson(postResetProof)) {
    throw new Error('Disposable target proof changed during reset')
  }
  const bytes = Buffer.from(`${canonicalProofJson(proof)}\n`)
  await writeFile(proofPath, bytes, { mode: 0o600, flag: 'wx' })
  await chmod(proofPath, 0o600)
  const verifiedProofPath = await verifiedExternalFile(workspace, proofPath)
  if (!(await readFile(verifiedProofPath)).equals(bytes)) {
    throw new Error('Restore-target proof write was not durable')
  }
  process.stdout.write(
    `${JSON.stringify({ status: 'disposable_stack_b_prepared', proofSha256: createHash('sha256').update(bytes).digest('hex') })}\n`,
  )
}

await main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.message
      : 'Local restore target preparation failed closed',
  )
  process.exit(1)
})
