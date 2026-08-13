import { spawnSync } from 'node:child_process'
import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'

import {
  BACKUP_ARTIFACT_KEYS,
  assertBackupManifest,
  assertContractKeys,
  assertEmptyRestoreTargetPreflight,
  assertForeignKeyCatalog,
  assertRestoredAuthEvidence,
  assertRestoredEvidence,
  buildAuthEvidenceSql,
  buildCriticalEvidenceSql,
  buildForeignKeyCatalogSql,
  buildForeignKeyViolationSql,
  buildRolePolicySql,
  buildServerIdentitySql,
  buildSensitiveAuthStateSql,
  canonicalJson,
  criticalRelationSchemas,
  fingerprintRolePolicy,
  loadCriticalRelationContract,
  loadSchemaGolden,
  roleRestoreRequired,
  sha256,
} from './critical-backup-contract.mjs'
import { validateRestoreTargetProof } from './lib/local-supabase-target-proof.mjs'
import {
  ownedPsql,
  runOwnedPostgresTool,
} from './lib/local-container-postgres.mjs'
import {
  verifiedDirectChild,
  verifiedExternalFile,
} from './lib/safe-artifact-path.mjs'
import {
  resolvedArguments,
  resolveNativeExecutable,
} from './lib/safe-process.mjs'

const DISPOSABLE_CONFIRMATION = 'seed-free-disposable-database-confirmed'

function options() {
  const entries = process.argv.slice(2).map((argument) => {
    const match =
      /^--(contract|expected-manifest-sha256|expected-target-proof-sha256|manifest|target-proof)=(.+)$/u.exec(
        argument,
      )
    if (!match) throw new Error('Restore arguments are invalid')
    return [match[1], match[2]]
  })
  const parsed = Object.fromEntries(entries)
  if (
    entries.length !== 5 ||
    new Set(entries.map(([key]) => key)).size !== 5 ||
    !['pre', 'post'].includes(parsed.contract) ||
    !/^[0-9a-f]{64}$/u.test(parsed['expected-manifest-sha256'] ?? '') ||
    !/^[0-9a-f]{64}$/u.test(parsed['expected-target-proof-sha256'] ?? '')
  ) {
    throw new Error(
      'Required: --contract=pre|post --manifest=<external> --expected-manifest-sha256=<external-hash> --target-proof=<external> --expected-target-proof-sha256=<external-hash>',
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

async function runPsql(role, args, input) {
  return (
    await runOwnedPostgresTool(
      role,
      'psql',
      ['--no-psqlrc', '--set=ON_ERROR_STOP=1', ...args],
      input,
    )
  ).stdout
}

async function evidence(role, sql) {
  return JSON.parse(await ownedPsql(role, sql))
}

async function assertForeignKeyIntegrity(role) {
  const catalog = await evidence(role, buildForeignKeyCatalogSql())
  assertForeignKeyCatalog(catalog)
  for (const specification of catalog.constraints) {
    const result = await evidence(
      role,
      buildForeignKeyViolationSql(specification),
    )
    if (result.violationCount !== '0') {
      throw new Error(
        'Restored database contains a foreign-key integrity violation',
      )
    }
  }
  return catalog
}

function inspectRestoreContainer(projectId) {
  if (!/^capital-lab-restore-[a-z0-9][a-z0-9-]{5,31}$/u.test(projectId ?? '')) {
    throw new Error('Disposable Supabase stack B project identity is invalid')
  }
  const executable = resolveNativeExecutable('docker')
  const result = spawnSync(
    executable.command,
    resolvedArguments(executable, ['inspect', `supabase_db_${projectId}`]),
    {
      encoding: 'utf8',
      shell: false,
      timeout: 30_000,
      windowsHide: true,
    },
  )
  if (result.status !== 0 || result.signal || result.error) {
    throw new Error(
      'Disposable Supabase stack B container proof is unavailable',
    )
  }
  const parsed = JSON.parse(result.stdout)
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new Error('Disposable Supabase stack B container is not unique')
  }
  return parsed[0]
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
  const workspace = await realpath(process.cwd())
  if (git(['status', '--porcelain=v1', '--untracked-files=all'], workspace)) {
    throw new Error(
      'Restore verification requires a completely clean Working Tree',
    )
  }
  const commitSha = git(['rev-parse', 'HEAD'], workspace)
  const targetProofPath = await verifiedExternalFile(
    workspace,
    requested['target-proof'],
  )
  const targetProofBytes = await readFile(targetProofPath)
  if (sha256(targetProofBytes) !== requested['expected-target-proof-sha256']) {
    throw new Error('Restore-target proof differs from its retained SHA-256')
  }
  const untrustedTargetProof = JSON.parse(targetProofBytes.toString('utf8'))
  const targetIdentity = await evidence('restore', buildServerIdentitySql())
  const markerEvidence = await evidence(
    'restore',
    `select jsonb_build_object(
      'database', current_database(), 'databaseRole', current_user,
      'runId', marker.run_id, 'disposableMarker', marker.disposable_marker::text
    ) from capital_lab_restore.run_identity as marker where marker.singleton;`,
  )
  const targetProof = validateRestoreTargetProof(
    targetProofBytes,
    requested['expected-target-proof-sha256'],
    inspectRestoreContainer(untrustedTargetProof.projectId),
    targetIdentity,
    sha256(canonicalJson(markerEvidence)),
  )
  if (
    targetProof.hostname !== '127.0.0.1' ||
    targetProof.port !== '55322' ||
    targetProof.database !== 'postgres' ||
    targetProof.runId !== markerEvidence.runId ||
    targetProof.disposableMarker !== markerEvidence.disposableMarker ||
    targetProof.databaseRole !== 'postgres'
  ) {
    throw new Error(
      'Restore URL differs from the retained stack B target proof',
    )
  }
  const manifestPath = await verifiedExternalFile(workspace, requested.manifest)
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
    schemaEvidenceSha256: golden.schemaEvidenceSha256,
    schemaFingerprintSha256: golden.schemaFingerprintSha256,
    schemaGoldenSha256,
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
    const artifact = await verifiedDirectChild(
      manifestDirectory,
      path.join(manifestDirectory, metadata.file),
    )
    if (sha256(await readFile(artifact)) !== metadata.sha256)
      throw new Error('Backup artifact checksum mismatch')
    artifacts[key] = artifact
  }
  const sourceIdentity = await evidence('source', buildServerIdentitySql())
  const sourceEvidenceBefore = await evidence(
    'source',
    buildCriticalEvidenceSql(contract),
  )
  const sourceAuthEvidenceBefore = await evidence(
    'source',
    buildAuthEvidenceSql(),
  )
  const sourceSensitiveAuthBefore = await evidence(
    'source',
    buildSensitiveAuthStateSql(),
  )
  const sourceForeignKeyCatalogBefore =
    await assertForeignKeyIntegrity('source')
  assertContractKeys(contract, sourceEvidenceBefore)
  assertRestoredEvidence(manifest, sourceEvidenceBefore)
  assertRestoredAuthEvidence(manifest, sourceAuthEvidenceBefore)
  if (
    targetProof.sourceServerFingerprint !==
      sha256(sourceIdentity.serverIdentity) ||
    targetProof.serverFingerprint === sha256(sourceIdentity.serverIdentity)
  ) {
    throw new Error('Retained source and target cluster binding changed')
  }
  const preflight = await evidence(
    'restore',
    `select jsonb_build_object(
      'userRelations', (select count(*) from pg_catalog.pg_class as class
        join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
        where class.relkind in ('r','p')
          and namespace.nspname in ('public','private','supabase_migrations')),
      'authPresent', pg_catalog.to_regnamespace('auth') is not null,
      'serverIdentity', current_setting('server_version_num') || ':' || control.system_identifier::text,
      'databaseIdentity', database.oid::text || ':' || current_database() || ':'
        || current_setting('server_version_num') || ':' || control.system_identifier::text
    )
    from pg_catalog.pg_control_system() as control
    cross join pg_catalog.pg_database as database
    where database.datname = current_database();\n`,
  )
  assertEmptyRestoreTargetPreflight(
    preflight,
    sourceIdentity.serverIdentity,
    manifest.source.databaseFingerprint,
  )
  const targetRolePolicy = fingerprintRolePolicy(
    await evidence('restore', buildRolePolicySql()),
  )
  if (
    roleRestoreRequired(
      manifest.source.rolePolicyFingerprint,
      targetRolePolicy,
      false,
    )
  ) {
    await runPsql('restore', [], await readFile(artifacts.roles))
  }
  for (const file of [
    artifacts.authSchema,
    restorePreludePath,
    artifacts.schema,
  ]) {
    await runPsql('restore', ['--single-transaction'], await readFile(file))
  }
  for (const file of [artifacts.authData, artifacts.data]) {
    await runPsql(
      'restore',
      ['--single-transaction'],
      Buffer.concat([
        Buffer.from('SET session_replication_role = replica;\n'),
        await readFile(file),
      ]),
    )
  }
  await runPsql(
    'restore',
    ['--single-transaction'],
    Buffer.concat([
      await readFile(artifacts.historySchema),
      Buffer.from('\n'),
      await readFile(artifacts.historyData),
    ]),
  )
  const actualEvidence = await evidence(
    'restore',
    buildCriticalEvidenceSql(contract),
  )
  assertContractKeys(contract, actualEvidence)
  assertRestoredEvidence(manifest, actualEvidence)
  assertRestoredAuthEvidence(
    manifest,
    await evidence('restore', buildAuthEvidenceSql()),
  )
  const restoredSensitiveAuth = await evidence(
    'restore',
    buildSensitiveAuthStateSql(),
  )
  const restoredForeignKeyCatalog = await assertForeignKeyIntegrity('restore')
  if (
    canonicalJson(restoredSensitiveAuth) !==
      canonicalJson(sourceSensitiveAuthBefore) ||
    canonicalJson(restoredForeignKeyCatalog) !==
      canonicalJson(sourceForeignKeyCatalogBefore)
  ) {
    throw new Error('Restored Auth or foreign-key closure differs from source')
  }
  if (
    actualEvidence.databaseFingerprint === manifest.source.databaseFingerprint
  ) {
    throw new Error(
      'Disposable restore unexpectedly reused the source database identity',
    )
  }
  const sourceIdentityAfter = await evidence('source', buildServerIdentitySql())
  const sourceEvidenceAfter = await evidence(
    'source',
    buildCriticalEvidenceSql(contract),
  )
  const sourceAuthEvidenceAfter = await evidence(
    'source',
    buildAuthEvidenceSql(),
  )
  const sourceSensitiveAuthAfter = await evidence(
    'source',
    buildSensitiveAuthStateSql(),
  )
  const sourceForeignKeyCatalogAfter = await assertForeignKeyIntegrity('source')
  const markerEvidenceAfter = await evidence(
    'restore',
    `select jsonb_build_object(
      'database', current_database(), 'databaseRole', current_user,
      'runId', marker.run_id, 'disposableMarker', marker.disposable_marker::text
    ) from capital_lab_restore.run_identity as marker where marker.singleton;`,
  )
  if (
    canonicalJson(sourceIdentity) !== canonicalJson(sourceIdentityAfter) ||
    canonicalJson(sourceEvidenceBefore) !==
      canonicalJson(sourceEvidenceAfter) ||
    canonicalJson(sourceAuthEvidenceBefore) !==
      canonicalJson(sourceAuthEvidenceAfter) ||
    canonicalJson(sourceSensitiveAuthBefore) !==
      canonicalJson(sourceSensitiveAuthAfter) ||
    canonicalJson(sourceForeignKeyCatalogBefore) !==
      canonicalJson(sourceForeignKeyCatalogAfter) ||
    canonicalJson(markerEvidence) !== canonicalJson(markerEvidenceAfter)
  ) {
    throw new Error(
      'Source identity or disposable target marker changed during restore',
    )
  }
  const targetProofPathAfter = await verifiedExternalFile(
    workspace,
    requested['target-proof'],
  )
  const manifestPathAfter = await verifiedExternalFile(
    workspace,
    requested.manifest,
  )
  if (
    targetProofPathAfter !== targetProofPath ||
    manifestPathAfter !== manifestPath ||
    sha256(await readFile(targetProofPathAfter)) !==
      requested['expected-target-proof-sha256'] ||
    sha256(await readFile(manifestPathAfter)) !==
      requested['expected-manifest-sha256']
  ) {
    throw new Error('Backup or target-proof identity changed during restore')
  }
  for (const key of BACKUP_ARTIFACT_KEYS) {
    const artifactAfter = await verifiedDirectChild(
      manifestDirectory,
      path.join(manifestDirectory, manifest.artifacts[key].file),
    )
    if (
      artifactAfter !== artifacts[key] ||
      sha256(await readFile(artifactAfter)) !== manifest.artifacts[key].sha256
    ) {
      throw new Error('Backup artifact identity changed during restore')
    }
  }
  process.stdout.write(
    `${JSON.stringify({ status: 'backup_restored', contractKind, relationCount: contract.relations.length, manifestSha256: requested['expected-manifest-sha256'], schemaMatchesGolden: true, activationEligible: false, authUserIdentityClosureVerified: true, sourceUnchanged: true })}\n`,
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
