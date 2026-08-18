const STATUS = 'local_migration_replay_boundary_observed'
const STAGE = 'history_preflight'
const ROLES = new Set(['reference', 'source'])
const CONTRACTS = new Set(['post', 'pre'])
const QUERY_KEYS = ['relationExists', 'schemaExists']
const DIAGNOSTIC_KEYS = [
  'contract',
  'historyRelationExists',
  'historySchemaExists',
  'psqlQueryCompleted',
  'role',
  'schemaVersion',
  'stage',
  'status',
]

export const HISTORY_PREFLIGHT_SQL = `select jsonb_build_object(
  'schemaExists',
  to_regnamespace('supabase_migrations') is not null,
  'relationExists',
  to_regclass('supabase_migrations.schema_migrations') is not null
);`

function exactKeys(value, expected) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join('\n') === [...expected].sort().join('\n')
  )
}

export function validateLocalMigrationReplayDiagnostic(value) {
  if (
    !exactKeys(value, DIAGNOSTIC_KEYS) ||
    value.schemaVersion !== 1 ||
    value.status !== STATUS ||
    value.stage !== STAGE ||
    !ROLES.has(value.role) ||
    !CONTRACTS.has(value.contract) ||
    value.psqlQueryCompleted !== true ||
    typeof value.historySchemaExists !== 'boolean' ||
    typeof value.historyRelationExists !== 'boolean'
  ) {
    throw new Error('Local migration replay diagnostic is invalid')
  }
  return {
    schemaVersion: 1,
    status: STATUS,
    stage: STAGE,
    role: value.role,
    contract: value.contract,
    psqlQueryCompleted: true,
    historySchemaExists: value.historySchemaExists,
    historyRelationExists: value.historyRelationExists,
  }
}

export function buildLocalMigrationReplayDiagnostic({
  contract,
  queryResult,
  role,
}) {
  if (
    !exactKeys(queryResult, QUERY_KEYS) ||
    typeof queryResult.schemaExists !== 'boolean' ||
    typeof queryResult.relationExists !== 'boolean'
  ) {
    throw new Error('Migration history preflight query result is invalid')
  }
  return validateLocalMigrationReplayDiagnostic({
    schemaVersion: 1,
    status: STATUS,
    stage: STAGE,
    role,
    contract,
    psqlQueryCompleted: true,
    historySchemaExists: queryResult.schemaExists,
    historyRelationExists: queryResult.relationExists,
  })
}

export function serializeLocalMigrationReplayDiagnostic(value) {
  return `${JSON.stringify(validateLocalMigrationReplayDiagnostic(value))}\n`
}

export function parseLocalMigrationReplayDiagnostic(output) {
  const candidates = String(output ?? '')
    .split(/\r?\n/u)
    .filter((line) => line.includes(STATUS))
  if (candidates.length === 0) return null
  if (candidates.length !== 1 || candidates[0].length > 2048) {
    throw new Error('Local migration replay diagnostic output is ambiguous')
  }
  let parsed
  try {
    parsed = JSON.parse(candidates[0])
  } catch {
    throw new Error('Local migration replay diagnostic output is invalid')
  }
  const validated = validateLocalMigrationReplayDiagnostic(parsed)
  if (JSON.stringify(validated) !== candidates[0]) {
    throw new Error('Local migration replay diagnostic output is not canonical')
  }
  return validated
}

export function requireLocalMigrationReplayDiagnostic(output) {
  const diagnostic = parseLocalMigrationReplayDiagnostic(output)
  if (!diagnostic) {
    throw new Error('Local migration replay diagnostic output is missing')
  }
  return diagnostic
}
