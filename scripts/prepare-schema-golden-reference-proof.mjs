import { spawnSync } from 'node:child_process'
import { chmod, readFile, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  buildSchemaGoldenEvidenceSql,
  buildServerIdentitySql,
  canonicalJson,
  loadCriticalRelationContract,
  sha256,
} from './critical-backup-contract.mjs'
import {
  inspectOwnedDatabaseContainer,
  ownedPsql,
} from './lib/local-container-postgres.mjs'
import { localCiImageIdentityEvidence } from './lib/owned-local-ci-stack.mjs'
import { buildSchemaGoldenReferenceProof } from './lib/schema-golden-reference-proof.mjs'
import { loadSchemaGoldenBootstrapContract } from './lib/schema-golden-bootstrap-contract.mjs'
import {
  newExternalPath,
  verifiedExternalFile,
} from './lib/safe-artifact-path.mjs'
import {
  resolvedArguments,
  resolveNativeExecutable,
} from './lib/safe-process.mjs'

function options() {
  const entries = process.argv.slice(2).map((argument) => {
    const match = /^--(contract|proof)=(.+)$/u.exec(argument)
    if (!match) throw new Error('Reference-proof arguments are invalid')
    return [match[1], match[2]]
  })
  const parsed = Object.fromEntries(entries)
  if (
    entries.length !== 2 ||
    new Set(entries.map(([key]) => key)).size !== 2 ||
    !['pre', 'post'].includes(parsed.contract)
  ) {
    throw new Error('Required: --contract=pre|post --proof=<new-external-file>')
  }
  return parsed
}

function git(args, cwd) {
  const executable = resolveNativeExecutable('git')
  const result = spawnSync(
    executable.command,
    resolvedArguments(executable, args),
    { cwd, encoding: 'utf8', shell: false, windowsHide: true },
  )
  if (result.status !== 0 || result.signal || result.error) {
    throw new Error('Reference-proof Git evidence could not be derived')
  }
  return result.stdout.trim()
}

async function evidence(sql) {
  return JSON.parse(await ownedPsql('reference', sql))
}

async function main() {
  const requested = options()
  const workspace = await realpath(process.cwd())
  if (git(['status', '--porcelain=v1', '--untracked-files=all'], workspace)) {
    throw new Error('Reference proof requires a clean Working Tree')
  }
  const runId = process.env.CAPITAL_LAB_REFERENCE_RUN_ID
  if (!/^run-[a-z0-9][a-z0-9-]{5,48}$/u.test(runId ?? '')) {
    throw new Error('Run-specific schema reference identity is required')
  }
  const projectId = `capital-lab-reference-${runId}`
  const port = process.env.CAPITAL_LAB_REFERENCE_DATABASE_PORT
  const target = inspectOwnedDatabaseContainer('reference')
  process.stdout.write(
    `${JSON.stringify({ status: 'local_container_image_identity_verified', role: 'reference', runId, ...localCiImageIdentityEvidence(target.identity) })}\n`,
  )
  const contractKind =
    requested.contract === 'pre' ? 'pre_activation' : 'post_activation'
  const contractPath = path.join(
    workspace,
    'supabase',
    'backup',
    `${requested.contract}-activation.v1.json`,
  )
  const { contract, sha256: relationContractSha256 } =
    await loadCriticalRelationContract(contractPath, contractKind)
  const { contract: bootstrapContract, sha256: bootstrapContractSha256 } =
    await loadSchemaGoldenBootstrapContract(workspace)
  const actual = await evidence(buildSchemaGoldenEvidenceSql(contract))
  const seedEvidence = await evidence(
    `select jsonb_build_object(
      'authUsers', (select count(*)::text from auth.users),
      'applicationUsers', (select count(*)::text from public.app_users)
    );`,
  )
  if (
    canonicalJson(actual.catalogRelations) !==
      canonicalJson(contract.relations.map((spec) => spec.relation)) ||
    canonicalJson(actual.appliedMigrations) !==
      canonicalJson(
        contract.migrations.map(({ name, version }) => ({
          name: name.slice(15, -4),
          version,
        })),
      ) ||
    seedEvidence.authUsers !== '0' ||
    seedEvidence.applicationUsers !== '0'
  ) {
    throw new Error('Reference cluster is seeded or not migration-exact')
  }
  const identity = await evidence(buildServerIdentitySql())
  const inspection = target.inspection
  const portBinding = inspection?.NetworkSettings?.Ports?.['5432/tcp']
  if (
    inspection?.Name !== `/supabase_db_${projectId}` ||
    inspection?.State?.Running !== true ||
    !/^[0-9a-f]{64}$/u.test(inspection?.Id ?? '') ||
    !Array.isArray(portBinding) ||
    portBinding.length !== 1 ||
    portBinding[0]?.HostIp !== '127.0.0.1' ||
    portBinding[0]?.HostPort !== port
  ) {
    throw new Error('Reference cluster container binding is invalid')
  }
  const proof = buildSchemaGoldenReferenceProof(
    {
      contractKind,
      runId,
      projectId,
      hostname: '127.0.0.1',
      port,
      database: 'postgres',
      databaseRole: identity.databaseRole,
      gitCommitSha: git(['rev-parse', 'HEAD'], workspace),
      relationContractSha256,
      migrationHistorySha256: actual.migrationHistorySha256,
      serverFingerprint: sha256(identity.serverIdentity),
      databaseFingerprint: sha256(identity.databaseIdentity),
      containerFingerprint: sha256(inspection.Id),
      containerImage: target.identity.runtimeImageReference,
      containerImageArchitecture: target.identity.imageArchitecture,
      containerImageId: target.identity.imageId,
      containerImageOs: target.identity.imageOs,
      containerImageRegistry: bootstrapContract.postgresImageRegistry,
      containerImageRepoDigest: target.identity.imageRepoDigest,
      supabaseCliVersion: bootstrapContract.supabaseCliVersion,
      bootstrapContractSha256,
      seedFree: true,
      builtFromReviewedMigrations: true,
      capturedAt: new Date().toISOString(),
    },
    bootstrapContract,
  )
  const output = await newExternalPath(workspace, requested.proof)
  const bytes = Buffer.from(`${canonicalJson(proof)}\n`)
  await writeFile(output, bytes, { mode: 0o600, flag: 'wx' })
  await chmod(output, 0o600)
  const verified = await verifiedExternalFile(workspace, output)
  if (!(await readFile(verified)).equals(bytes)) {
    throw new Error('Reference proof write was not durable')
  }
  process.stdout.write(
    `${JSON.stringify({ status: 'schema_golden_reference_proved', contractKind, proofSha256: sha256(bytes) })}\n`,
  )
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : 'Reference proof failed closed',
    )
    process.exit(1)
  })
}
