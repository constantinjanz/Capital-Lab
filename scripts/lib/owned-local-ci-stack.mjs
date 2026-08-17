import { createHash } from 'node:crypto'

const RUN_ID = /^run-[a-z0-9][a-z0-9-]{4,31}$/u
const HASH = /^[0-9a-f]{64}$/u

export const LOCAL_CI_DATABASE_PORT = '54322'
export const LOCAL_CI_DATABASE = 'postgres'
export const LOCAL_CI_HOST = '127.0.0.1'
export const LOCAL_CI_IMAGE = 'public.ecr.aws/supabase/postgres:17.6.1.158'
export const LOCAL_CI_RESET_CONFIRMATION =
  'RESET OWNED CAPITAL LAB CI STACK postgres'

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function localCiProjectId(runId) {
  if (!RUN_ID.test(runId ?? '')) throw new Error('Local CI run ID is invalid')
  return `capital-lab-ci-${runId}`
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

export function validateLocalCiContainerInspection(inspection, runId) {
  const projectId = localCiProjectId(runId)
  const bindings = inspection?.NetworkSettings?.Ports?.['5432/tcp']
  const binding =
    Array.isArray(bindings) && bindings.length === 1 ? bindings[0] : null
  if (
    inspection?.Name !== `/supabase_db_${projectId}` ||
    inspection?.State?.Running !== true ||
    !/^[0-9a-f]{64}$/u.test(inspection?.Id ?? '') ||
    inspection?.Config?.Image !== LOCAL_CI_IMAGE ||
    binding?.HostIp !== LOCAL_CI_HOST ||
    binding?.HostPort !== LOCAL_CI_DATABASE_PORT
  ) {
    throw new Error('Owned local CI database container identity is invalid')
  }
  return {
    containerIdSha256: sha256(inspection.Id),
    image: LOCAL_CI_IMAGE,
    projectId,
  }
}
