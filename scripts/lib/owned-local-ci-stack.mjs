import { createHash } from 'node:crypto'

const RUN_ID = /^run-[a-z0-9][a-z0-9-]{4,31}$/u
const REFERENCE_RUN_ID = /^run-(pre|post)-(a|b)-([a-z0-9][a-z0-9-]{4,27})$/u
const HASH = /^[0-9a-f]{64}$/u

export const LOCAL_CI_DATABASE_PORT = '54322'
export const LOCAL_CI_DATABASE = 'postgres'
export const LOCAL_CI_HOST = '127.0.0.1'
export const LOCAL_CI_IMAGE = 'ghcr.io/supabase/postgres:17.6.1.158'
export const LOCAL_CI_IMAGE_ARCHITECTURE = 'amd64'
export const LOCAL_CI_IMAGE_ID =
  'sha256:1ea9ca2e6b7be9424fed2bb2ba1a550dac552ba60ac798688e38709feec15864'
export const LOCAL_CI_IMAGE_OS = 'linux'
export const LOCAL_CI_IMAGE_REGISTRY = 'ghcr.io/supabase'
export const LOCAL_CI_IMAGE_REPO_DIGEST =
  'ghcr.io/supabase/postgres@sha256:99b1729aeb0bac314445024fc149fbd39306170b61dd50800ccf180327ab3459'
export const LOCAL_CI_PROVENANCE_IMAGE =
  'public.ecr.aws/supabase/postgres:17.6.1.158'
export const LOCAL_CI_RESET_CONFIRMATION =
  'RESET OWNED CAPITAL LAB CI STACK postgres'

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function localCiProjectId(runId) {
  if (!RUN_ID.test(runId ?? '')) throw new Error('Local CI run ID is invalid')
  return `capital-lab-ci-${runId}`
}

export function canonicalReferenceRunId(rootRunId, contract, replica) {
  if (
    !RUN_ID.test(rootRunId ?? '') ||
    !['pre', 'post'].includes(contract) ||
    !['a', 'b'].includes(replica)
  ) {
    throw new Error('Reference run identity is invalid')
  }
  const runId = `run-${contract}-${replica}-${rootRunId.slice(4)}`
  if (!REFERENCE_RUN_ID.test(runId)) {
    throw new Error('Reference run identity is invalid')
  }
  return runId
}

export function canonicalReferenceProjectId(runId) {
  const match = REFERENCE_RUN_ID.exec(runId ?? '')
  if (!match) throw new Error('Reference run identity is invalid')
  const [, contract, replica] = match
  const entropy = sha256(
    `capital-lab-schema-golden-reference-v1:${runId}`,
  ).slice(0, 16)
  const projectId = `capital-lab-ref-${contract}-${replica}-${entropy}`
  if (projectId.length > 40 || !/^[a-z0-9][a-z0-9-]+$/u.test(projectId)) {
    throw new Error('Canonical Reference project identity is invalid')
  }
  return projectId
}

export function validateLocalCiSqlTestName(name) {
  if (!/^[a-z0-9][a-z0-9_]*\.sql$/u.test(name ?? '')) {
    throw new Error('Supabase SQL test closure contains an unexpected entry')
  }
  return name
}

export function localCiConfig(runId) {
  const projectId = localCiProjectId(runId)
  return `project_id = "${projectId}"

[api]
enabled = true
port = 54321
schemas = ["public", "graphql_public"]
extra_search_path = ["public", "extensions"]
max_rows = 1000

[db]
port = 54322
shadow_port = 54320
major_version = 17

[db.migrations]
enabled = false
schema_paths = []

[db.seed]
enabled = false
sql_paths = []

[studio]
enabled = false
port = 54323

[auth]
enabled = true
site_url = "http://127.0.0.1:3000"
additional_redirect_urls = ["http://localhost:3000/**"]
jwt_expiry = 3600
enable_signup = false
enable_anonymous_sign_ins = false

[auth.email]
enable_signup = false
double_confirm_changes = true
enable_confirmations = false

[storage]
enabled = true
file_size_limit = "25MiB"

[analytics]
enabled = false
`
}

export function localCiMarker(runId, configBytes) {
  return {
    configSha256: sha256(configBytes),
    database: LOCAL_CI_DATABASE,
    hostname: LOCAL_CI_HOST,
    port: LOCAL_CI_DATABASE_PORT,
    projectId: localCiProjectId(runId),
    runId,
    schemaVersion: 1,
  }
}

export function validateLocalCiMarker(marker, runId, configBytes) {
  const expected = localCiMarker(runId, configBytes)
  if (
    !marker ||
    Object.keys(marker).sort().join('\n') !==
      Object.keys(expected).sort().join('\n') ||
    JSON.stringify(marker) !== JSON.stringify(expected) ||
    !HASH.test(marker.configSha256)
  ) {
    throw new Error('Owned local CI stack marker is invalid')
  }
  return expected
}

export function validateOwnedLocalDatabaseContainerBinding(
  inspection,
  { container, port, projectId },
) {
  const bindings = inspection?.NetworkSettings?.Ports?.['5432/tcp']
  const binding =
    Array.isArray(bindings) && bindings.length === 1 ? bindings[0] : null
  if (
    inspection?.Name !== `/${container}` ||
    inspection?.State?.Running !== true ||
    !/^[0-9a-f]{64}$/u.test(inspection?.Id ?? '') ||
    !/^sha256:[0-9a-f]{64}$/u.test(inspection?.Image ?? '') ||
    inspection?.Config?.Image !== LOCAL_CI_IMAGE ||
    binding?.HostIp !== LOCAL_CI_HOST ||
    binding?.HostPort !== port
  ) {
    throw new Error('Owned local database container binding is invalid')
  }
  return {
    containerIdSha256: sha256(inspection.Id),
    containerImageId: inspection.Image,
    runtimeImageReference: inspection.Config.Image,
    projectId,
  }
}

export function validateOwnedLocalDatabaseImageInspection(
  containerInspection,
  imageInspections,
) {
  if (!Array.isArray(imageInspections) || imageInspections.length !== 1) {
    throw new Error('Owned local database image inspection is not unique')
  }
  const image = imageInspections[0]
  if (
    containerInspection?.Image !== LOCAL_CI_IMAGE_ID ||
    image?.Id !== LOCAL_CI_IMAGE_ID ||
    image?.Os !== LOCAL_CI_IMAGE_OS ||
    image?.Architecture !== LOCAL_CI_IMAGE_ARCHITECTURE ||
    !Array.isArray(image?.RepoDigests) ||
    image.RepoDigests.length !== 1 ||
    image.RepoDigests[0] !== LOCAL_CI_IMAGE_REPO_DIGEST
  ) {
    throw new Error('Owned local database immutable image identity is invalid')
  }
  return {
    imageArchitecture: LOCAL_CI_IMAGE_ARCHITECTURE,
    imageId: LOCAL_CI_IMAGE_ID,
    imageOs: LOCAL_CI_IMAGE_OS,
    imageRepoDigest: LOCAL_CI_IMAGE_REPO_DIGEST,
    runtimeImageReference: LOCAL_CI_IMAGE,
  }
}

export function validateOwnedLocalDatabaseIdentity(
  containerInspection,
  imageInspections,
  expectedContainer,
) {
  return {
    ...validateOwnedLocalDatabaseContainerBinding(
      containerInspection,
      expectedContainer,
    ),
    ...validateOwnedLocalDatabaseImageInspection(
      containerInspection,
      imageInspections,
    ),
  }
}

export function localCiImageIdentityEvidence(identity) {
  if (
    identity?.runtimeImageReference !== LOCAL_CI_IMAGE ||
    identity?.imageId !== LOCAL_CI_IMAGE_ID ||
    identity?.imageRepoDigest !== LOCAL_CI_IMAGE_REPO_DIGEST ||
    identity?.imageOs !== LOCAL_CI_IMAGE_OS ||
    identity?.imageArchitecture !== LOCAL_CI_IMAGE_ARCHITECTURE
  ) {
    throw new Error('Owned local database image evidence is invalid')
  }
  return {
    runtimeImageReference: LOCAL_CI_IMAGE,
    imageRepoDigest: LOCAL_CI_IMAGE_REPO_DIGEST,
    imageId: LOCAL_CI_IMAGE_ID,
    imageOs: LOCAL_CI_IMAGE_OS,
    imageArchitecture: LOCAL_CI_IMAGE_ARCHITECTURE,
  }
}

export function validateLocalCiContainerInspection(
  inspection,
  imageInspections,
  runId,
) {
  const projectId = localCiProjectId(runId)
  return validateOwnedLocalDatabaseIdentity(inspection, imageInspections, {
    container: `supabase_db_${projectId}`,
    port: LOCAL_CI_DATABASE_PORT,
    projectId,
  })
}
