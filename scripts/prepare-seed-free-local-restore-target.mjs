import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, readFile, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  buildServerIdentitySql,
  canonicalJson,
  sha256,
} from './critical-backup-contract.mjs'
import {
  inspectOwnedDatabaseContainer,
  ownedPsql,
} from './lib/local-container-postgres.mjs'
import {
  buildRestoreTargetProof,
  canonicalJson as canonicalProofJson,
} from './lib/local-supabase-target-proof.mjs'
import { localCiImageIdentityEvidence } from './lib/owned-local-ci-stack.mjs'
import {
  resolvedArguments,
  resolveNativeExecutable,
} from './lib/safe-process.mjs'
import {
  newExternalPath,
  verifiedExternalFile,
} from './lib/safe-artifact-path.mjs'

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

async function databaseEvidence(role, sql) {
  return JSON.parse(await ownedPsql(role, sql))
}

export function validateDestructiveResetBinding({
  proof,
  inspection,
  imageInspections,
  targetIdentity,
  proofBinding,
  preparedAt,
  target,
}) {
  const canonical = buildRestoreTargetProof(
    inspection,
    imageInspections,
    targetIdentity,
    proofBinding,
    preparedAt,
  )
  if (
    canonicalProofJson(proof) !== canonicalProofJson(canonical) ||
    proof.hostname !== '127.0.0.1' ||
    proof.port !== '55322' ||
    proof.database !== 'postgres' ||
    proof.databaseRole !== 'postgres' ||
    proof.hostname !== target.hostname ||
    proof.port !== target.port ||
    proof.database !== target.database ||
    proof.runId !== proofBinding.runId ||
    proof.disposableMarker !== proofBinding.disposableMarker ||
    proof.serverFingerprint === proof.sourceServerFingerprint
  ) {
    throw new Error('Destructive target authority is invalid')
  }
  return canonical
}

export async function executeDestructiveReset(binding, destructiveAction) {
  validateDestructiveResetBinding(binding)
  return destructiveAction()
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
  const target = { database: 'postgres', hostname: '127.0.0.1', port: '55322' }
  const targetContainer = inspectOwnedDatabaseContainer('restore')
  const inspection = targetContainer.inspection
  const imageInspections = [targetContainer.imageInspection]
  const containerIdentity = targetContainer.identity
  process.stdout.write(
    `${JSON.stringify({ status: 'local_container_image_identity_verified', role: 'restore', ...localCiImageIdentityEvidence(containerIdentity) })}\n`,
  )
  if (
    target.port !== '55322' ||
    containerIdentity.hostname !== target.hostname ||
    containerIdentity.port !== target.port ||
    containerIdentity.database !== target.database
  ) {
    throw new Error(
      'Disposable container differs from the fixed target boundary',
    )
  }
  const sourceIdentity = await databaseEvidence(
    'source',
    buildServerIdentitySql(),
  )
  const targetIdentity = await databaseEvidence(
    'restore',
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
  await ownedPsql(
    'restore',
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
    false,
  )
  const markerEvidence = await databaseEvidence(
    'restore',
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
    imageInspections,
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
  await executeDestructiveReset(
    {
      proof,
      inspection,
      imageInspections,
      targetIdentity,
      proofBinding,
      preparedAt,
      target,
    },
    () =>
      ownedPsql(
        'restore',
        `begin;
drop schema if exists private cascade;
drop schema if exists public cascade;
drop schema if exists supabase_migrations cascade;
drop schema if exists auth cascade;
create schema public authorization postgres;
commit;
`,
        false,
      ),
  )
  const postResetIdentity = await databaseEvidence(
    'restore',
    buildServerIdentitySql(),
  )
  const postResetMarkerEvidence = await databaseEvidence(
    'restore',
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
  const postResetContainer = inspectOwnedDatabaseContainer('restore')
  const postResetInspection = postResetContainer.inspection
  const postResetProof = buildRestoreTargetProof(
    postResetInspection,
    [postResetContainer.imageInspection],
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

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main().catch((error) => {
    console.error(
      error instanceof Error
        ? error.message
        : 'Local restore target preparation failed closed',
    )
    process.exit(1)
  })
}
