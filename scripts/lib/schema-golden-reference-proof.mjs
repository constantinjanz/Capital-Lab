import { createHash } from 'node:crypto'

import { canonicalReferenceProjectId } from './owned-local-ci-stack.mjs'

const HASH = /^[0-9a-f]{64}$/u
const SHA = /^[0-9a-f]{40}$/u
const RUN_ID = /^run-[a-z0-9][a-z0-9-]{5,48}$/u
const PROOF_KEYS = [
  'bootstrapContractSha256',
  'builtFromReviewedMigrations',
  'capturedAt',
  'containerFingerprint',
  'containerImage',
  'containerImageArchitecture',
  'containerImageId',
  'containerImageOs',
  'containerImageRegistry',
  'containerImageRepoDigest',
  'contractKind',
  'database',
  'databaseFingerprint',
  'databaseRole',
  'gitCommitSha',
  'hostname',
  'migrationHistorySha256',
  'port',
  'projectId',
  'relationContractSha256',
  'runId',
  'schemaVersion',
  'seedFree',
  'serverFingerprint',
  'supabaseCliVersion',
]

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function buildSchemaGoldenReferenceProof(input, bootstrap) {
  const proof = {
    schemaVersion: 3,
    contractKind: input.contractKind,
    runId: input.runId,
    projectId: input.projectId,
    hostname: input.hostname,
    port: input.port,
    database: input.database,
    databaseRole: input.databaseRole,
    gitCommitSha: input.gitCommitSha,
    relationContractSha256: input.relationContractSha256,
    migrationHistorySha256: input.migrationHistorySha256,
    serverFingerprint: input.serverFingerprint,
    databaseFingerprint: input.databaseFingerprint,
    containerFingerprint: input.containerFingerprint,
    containerImage: input.containerImage,
    containerImageArchitecture: input.containerImageArchitecture,
    containerImageId: input.containerImageId,
    containerImageOs: input.containerImageOs,
    containerImageRegistry: input.containerImageRegistry,
    containerImageRepoDigest: input.containerImageRepoDigest,
    supabaseCliVersion: input.supabaseCliVersion,
    bootstrapContractSha256: input.bootstrapContractSha256,
    seedFree: input.seedFree,
    builtFromReviewedMigrations: input.builtFromReviewedMigrations,
    capturedAt: input.capturedAt,
  }
  validateShape(proof, bootstrap)
  return {
    ...proof,
    evidenceSha256: createHash('sha256').update(canonical(proof)).digest('hex'),
  }
}

function validateShape(proof, bootstrap) {
  if (
    !proof ||
    typeof proof !== 'object' ||
    Array.isArray(proof) ||
    Object.keys(proof).sort().join('\n') !== PROOF_KEYS.sort().join('\n') ||
    proof.schemaVersion !== 3 ||
    !['pre_activation', 'post_activation'].includes(proof?.contractKind) ||
    !RUN_ID.test(proof?.runId ?? '') ||
    proof?.projectId !== canonicalReferenceProjectId(proof.runId) ||
    proof?.hostname !== '127.0.0.1' ||
    !/^5[6-9][0-9]{3}$/u.test(proof?.port ?? '') ||
    proof?.database !== 'postgres' ||
    proof?.databaseRole !== 'postgres' ||
    !SHA.test(proof?.gitCommitSha ?? '') ||
    !HASH.test(proof?.relationContractSha256 ?? '') ||
    !HASH.test(proof?.migrationHistorySha256 ?? '') ||
    !HASH.test(proof?.serverFingerprint ?? '') ||
    !HASH.test(proof?.databaseFingerprint ?? '') ||
    !HASH.test(proof?.containerFingerprint ?? '') ||
    proof?.containerImage !== bootstrap?.postgresImage ||
    proof?.containerImageArchitecture !==
      bootstrap?.postgresImageArchitecture ||
    proof?.containerImageId !== bootstrap?.postgresImageId ||
    proof?.containerImageOs !== bootstrap?.postgresImageOs ||
    proof?.containerImageRegistry !== bootstrap?.postgresImageRegistry ||
    proof?.containerImageRepoDigest !== bootstrap?.postgresImageRepoDigest ||
    proof?.supabaseCliVersion !== bootstrap?.supabaseCliVersion ||
    !HASH.test(proof?.bootstrapContractSha256 ?? '') ||
    proof?.seedFree !== true ||
    proof?.builtFromReviewedMigrations !== true ||
    Number.isNaN(Date.parse(proof?.capturedAt ?? ''))
  ) {
    throw new Error('Schema-golden reference proof is invalid')
  }
}

export function validateSchemaGoldenReferenceProof(
  proof,
  expected,
  referenceIdentity,
  peerReferenceIdentity,
) {
  const { evidenceSha256, ...payload } = proof ?? {}
  validateShape(payload, expected.bootstrapContract)
  if (
    !HASH.test(evidenceSha256 ?? '') ||
    evidenceSha256 !==
      createHash('sha256').update(canonical(payload)).digest('hex') ||
    payload.contractKind !== expected.contractKind ||
    payload.gitCommitSha !== expected.gitCommitSha ||
    payload.relationContractSha256 !== expected.relationContractSha256 ||
    payload.migrationHistorySha256 !== expected.migrationHistorySha256 ||
    payload.bootstrapContractSha256 !== expected.bootstrapContractSha256 ||
    payload.databaseRole !== referenceIdentity.databaseRole ||
    payload.serverFingerprint !==
      expected.sha256(referenceIdentity.serverIdentity) ||
    payload.databaseFingerprint !==
      expected.sha256(referenceIdentity.databaseIdentity) ||
    referenceIdentity.serverIdentity === peerReferenceIdentity.serverIdentity ||
    referenceIdentity.databaseIdentity ===
      peerReferenceIdentity.databaseIdentity
  ) {
    throw new Error('Schema-golden reference proof is stale or circular')
  }
  return proof
}
