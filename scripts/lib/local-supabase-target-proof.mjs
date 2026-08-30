import { createHash } from 'node:crypto'

import { validateOwnedLocalDatabaseIdentity } from './owned-local-ci-stack.mjs'

const HASH = /^[0-9a-f]{64}$/u
const RUN_ID = /^[a-z0-9][a-z0-9-]{5,31}$/u
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const EXPECTED_DATABASE = 'postgres'
const EXPECTED_HOST = '127.0.0.1'
const EXPECTED_PORT = '55322'

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function restoreProjectId(runId) {
  if (!RUN_ID.test(runId ?? '')) throw new Error('Restore run ID is invalid')
  return `capital-lab-restore-${runId}`
}

export function validateRestoreContainerInspection(
  inspection,
  imageInspections,
  runId,
) {
  const projectId = restoreProjectId(runId)
  const validated = validateOwnedLocalDatabaseIdentity(
    inspection,
    imageInspections,
    {
      container: `supabase_db_${projectId}`,
      port: EXPECTED_PORT,
      projectId,
    },
  )
  return {
    ...validated,
    database: EXPECTED_DATABASE,
    hostname: EXPECTED_HOST,
    port: EXPECTED_PORT,
    projectId,
    runId,
  }
}

function exactIdentity(identity) {
  if (
    typeof identity?.databaseIdentity !== 'string' ||
    typeof identity?.serverIdentity !== 'string' ||
    identity?.databaseRole !== 'postgres'
  ) {
    throw new Error('Disposable Supabase stack B database identity is invalid')
  }
  return identity
}

export function buildRestoreTargetProof(
  inspection,
  imageInspections,
  identity,
  binding,
  preparedAt,
) {
  const container = validateRestoreContainerInspection(
    inspection,
    imageInspections,
    binding?.runId,
  )
  exactIdentity(identity)
  if (
    !UUID.test(binding?.disposableMarker ?? '') ||
    !HASH.test(binding?.sourceServerFingerprint ?? '') ||
    !HASH.test(binding?.markerEvidenceSha256 ?? '') ||
    Number.isNaN(Date.parse(preparedAt))
  ) {
    throw new Error('Disposable Supabase stack B run binding is invalid')
  }
  const serverFingerprint = sha256(identity.serverIdentity)
  if (serverFingerprint === binding.sourceServerFingerprint) {
    throw new Error('Source and restore target use the same PostgreSQL cluster')
  }
  return {
    ...container,
    databaseFingerprint: sha256(identity.databaseIdentity),
    databaseRole: identity.databaseRole,
    disposableMarker: binding.disposableMarker,
    markerEvidenceSha256: binding.markerEvidenceSha256,
    preparedAt,
    schemaVersion: 3,
    serverFingerprint,
    sourceServerFingerprint: binding.sourceServerFingerprint,
  }
}

export function validateRestoreTargetProof(
  bytes,
  expectedSha256,
  inspection,
  imageInspections,
  identity,
  markerEvidenceSha256,
) {
  if (!HASH.test(expectedSha256) || sha256(bytes) !== expectedSha256) {
    throw new Error('Restore-target proof differs from its retained SHA-256')
  }
  const proof = JSON.parse(Buffer.from(bytes).toString('utf8'))
  if (
    Buffer.from(bytes).toString('utf8') !== `${canonicalJson(proof)}\n` ||
    Date.parse(proof.preparedAt) < Date.now() - 30 * 60 * 1000 ||
    Date.parse(proof.preparedAt) > Date.now() + 60 * 1000 ||
    proof.markerEvidenceSha256 !== markerEvidenceSha256 ||
    canonicalJson(proof) !==
      canonicalJson(
        buildRestoreTargetProof(
          inspection,
          imageInspections,
          identity,
          {
            disposableMarker: proof.disposableMarker,
            markerEvidenceSha256,
            runId: proof.runId,
            sourceServerFingerprint: proof.sourceServerFingerprint,
          },
          proof.preparedAt,
        ),
      )
  ) {
    throw new Error('Restore-target proof is stale or non-canonical')
  }
  return proof
}
