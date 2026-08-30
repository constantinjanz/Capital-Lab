import { constants as osConstants } from 'node:os'

const STATUS = 'local_migration_replay_boundary_observed'
const REFERENCE_STATUS = 'schema_golden_reference_migration_replay_observed'
const FAILURE_STATUS = 'local_migration_replay_failure_observed'
const REFERENCE_FAILURE_STATUS =
  'schema_golden_reference_migration_replay_failure_observed'
const STAGE = 'history_preflight'
const ROLES = new Set(['reference', 'source'])
const CONTRACTS = new Set(['post', 'pre'])
const REPLICAS = new Set(['a', 'b'])
const FAILURE_STAGES = new Set([
  'final_history_contract',
  'history_bootstrap',
  'history_contract',
  'history_insert',
  'history_preflight',
  'migration_apply',
])
const MIGRATION_FAILURE_STAGES = new Set(['history_insert', 'migration_apply'])
const LOGICAL_FAILURE_STAGES = new Set([
  'final_history_contract',
  'history_contract',
  'history_preflight',
])
const SIGNALS = new Set(Object.keys(osConstants.signals))
const SQLSTATE = /^[0-9A-Z]{5}$/u
const MIGRATION_BASENAME = /^[0-9]{14}_[a-z0-9_]+\.sql$/u
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
const REFERENCE_OBSERVATION_KEYS = [
  'contract',
  'localMigrationReplayDiagnostic',
  'replica',
  'schemaVersion',
  'status',
]
const FAILURE_KEYS = [
  'completedMigrationCount',
  'contract',
  'migrationBasename',
  'psqlExitCode',
  'role',
  'schemaVersion',
  'signal',
  'sqlstate',
  'stage',
  'status',
  'timedOut',
]
const REFERENCE_FAILURE_OBSERVATION_KEYS = [
  'contract',
  'localMigrationReplayFailureDiagnostic',
  'replica',
  'schemaVersion',
  'status',
]
const REFERENCE_SEQUENCE = [
  ['pre', 'a'],
  ['pre', 'b'],
  ['post', 'a'],
  ['post', 'b'],
]

export const HISTORY_PREFLIGHT_SQL = `select jsonb_build_object(
  'schemaExists',
  to_regnamespace('supabase_migrations') is not null,
  'relationExists',
  to_regclass('supabase_migrations.schema_migrations') is not null
);`

export const LOCAL_MIGRATION_REPLAY_CLIENT_STAGE_MARKER_PREFIX =
  'CAPITAL_LAB_CLIENT_STAGE_MARKER:MIGRATION_REPLAY:'

export function localMigrationReplayClientStageMarkerPlan(
  value,
  migrationBasenames,
) {
  const diagnostic = validateLocalMigrationReplayFailureDiagnostic(
    {
      schemaVersion: 1,
      status: FAILURE_STATUS,
      role: 'source',
      contract: 'pre',
      stage: value.stage,
      migrationBasename: value.migrationBasename,
      completedMigrationCount: value.completedMigrationCount,
      psqlExitCode: null,
      sqlstate: null,
      signal: null,
      timedOut: true,
    },
    migrationBasenames,
  )
  const marker = `${LOCAL_MIGRATION_REPLAY_CLIENT_STAGE_MARKER_PREFIX}0|${diagnostic.stage}|${diagnostic.completedMigrationCount}|${diagnostic.migrationBasename ?? '-'}`
  return {
    prefix: LOCAL_MIGRATION_REPLAY_CLIENT_STAGE_MARKER_PREFIX,
    markers: [marker],
  }
}

function exactKeys(value, expected) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join('\n') === [...expected].sort().join('\n')
  )
}

function requireMigrationBasenames(value) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    new Set(value).size !== value.length ||
    value.some(
      (entry) => typeof entry !== 'string' || !MIGRATION_BASENAME.test(entry),
    )
  ) {
    throw new Error('Local migration replay contract is invalid')
  }
  return [...value]
}

function requireMigrationBasenamesByContract(value) {
  if (!exactKeys(value, ['post', 'pre'])) {
    throw new Error('Schema Golden Reference replay contracts are invalid')
  }
  return {
    pre: requireMigrationBasenames(value.pre),
    post: requireMigrationBasenames(value.post),
  }
}

function validProcessFailureShape(value) {
  const exitCode = value.psqlExitCode
  const signal = value.signal
  const sqlstate = value.sqlstate
  if (
    value.timedOut === true &&
    exitCode === null &&
    sqlstate === null &&
    (signal === null || SIGNALS.has(signal))
  ) {
    return true
  }
  if (
    value.timedOut === false &&
    exitCode === null &&
    SIGNALS.has(signal) &&
    sqlstate === null
  ) {
    return true
  }
  if (
    value.timedOut === false &&
    Number.isInteger(exitCode) &&
    exitCode > 0 &&
    exitCode <= 255 &&
    signal === null &&
    typeof sqlstate === 'string' &&
    SQLSTATE.test(sqlstate) &&
    sqlstate !== '00000'
  ) {
    return true
  }
  return (
    value.timedOut === false &&
    exitCode === null &&
    signal === null &&
    sqlstate === null &&
    LOGICAL_FAILURE_STAGES.has(value.stage)
  )
}

export function validateLocalMigrationReplayFailureDiagnostic(
  value,
  migrationBasenames,
) {
  const migrations = requireMigrationBasenames(migrationBasenames)
  if (
    !exactKeys(value, FAILURE_KEYS) ||
    value.schemaVersion !== 1 ||
    value.status !== FAILURE_STATUS ||
    !ROLES.has(value.role) ||
    !CONTRACTS.has(value.contract) ||
    !FAILURE_STAGES.has(value.stage) ||
    !Number.isInteger(value.completedMigrationCount) ||
    value.completedMigrationCount < 0 ||
    value.completedMigrationCount > migrations.length ||
    !validProcessFailureShape(value)
  ) {
    throw new Error('Local migration replay failure diagnostic is invalid')
  }
  if (MIGRATION_FAILURE_STAGES.has(value.stage)) {
    if (
      typeof value.migrationBasename !== 'string' ||
      migrations[value.completedMigrationCount] !== value.migrationBasename
    ) {
      throw new Error('Local migration replay failure diagnostic is invalid')
    }
  } else if (value.migrationBasename !== null) {
    throw new Error('Local migration replay failure diagnostic is invalid')
  }
  if (
    (['history_preflight', 'history_bootstrap', 'history_contract'].includes(
      value.stage,
    ) &&
      value.completedMigrationCount !== 0) ||
    (value.stage === 'final_history_contract' &&
      value.completedMigrationCount !== migrations.length)
  ) {
    throw new Error('Local migration replay failure diagnostic is invalid')
  }
  return {
    schemaVersion: 1,
    status: FAILURE_STATUS,
    role: value.role,
    contract: value.contract,
    stage: value.stage,
    migrationBasename: value.migrationBasename,
    completedMigrationCount: value.completedMigrationCount,
    psqlExitCode: value.psqlExitCode,
    sqlstate: value.sqlstate,
    signal: value.signal,
    timedOut: value.timedOut,
  }
}

export function buildLocalMigrationReplayFailureDiagnostic(
  value,
  migrationBasenames,
) {
  return validateLocalMigrationReplayFailureDiagnostic(
    {
      schemaVersion: 1,
      status: FAILURE_STATUS,
      role: value.role,
      contract: value.contract,
      stage: value.stage,
      migrationBasename: value.migrationBasename,
      completedMigrationCount: value.completedMigrationCount,
      psqlExitCode: value.psqlExitCode,
      sqlstate: value.sqlstate,
      signal: value.signal,
      timedOut: value.timedOut,
    },
    migrationBasenames,
  )
}

export function serializeLocalMigrationReplayFailureDiagnostic(
  value,
  migrationBasenames,
) {
  return `${JSON.stringify(
    validateLocalMigrationReplayFailureDiagnostic(value, migrationBasenames),
  )}\n`
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

export function requireLocalMigrationReplayBootstrapEligibility(
  value,
  expected,
) {
  const diagnostic = validateLocalMigrationReplayDiagnostic(value)
  if (
    !exactKeys(expected, ['contract', 'role']) ||
    !ROLES.has(expected.role) ||
    !CONTRACTS.has(expected.contract) ||
    diagnostic.role !== expected.role ||
    diagnostic.contract !== expected.contract ||
    diagnostic.historySchemaExists !== false ||
    diagnostic.historyRelationExists !== false
  ) {
    throw new Error('Local migration replay bootstrap is not eligible')
  }
  return diagnostic
}

export function validateSchemaGoldenReferenceMigrationReplayObservation(value) {
  if (
    !exactKeys(value, REFERENCE_OBSERVATION_KEYS) ||
    value.schemaVersion !== 1 ||
    value.status !== REFERENCE_STATUS ||
    !CONTRACTS.has(value.contract) ||
    !REPLICAS.has(value.replica)
  ) {
    throw new Error('Schema Golden Reference replay observation is invalid')
  }
  const diagnostic = validateLocalMigrationReplayDiagnostic(
    value.localMigrationReplayDiagnostic,
  )
  if (
    diagnostic.role !== 'reference' ||
    diagnostic.contract !== value.contract ||
    diagnostic.historySchemaExists !== false ||
    diagnostic.historyRelationExists !== false
  ) {
    throw new Error('Schema Golden Reference replay observation is invalid')
  }
  return {
    schemaVersion: 1,
    status: REFERENCE_STATUS,
    contract: value.contract,
    replica: value.replica,
    localMigrationReplayDiagnostic: diagnostic,
  }
}

export function buildSchemaGoldenReferenceMigrationReplayObservation({
  contract,
  diagnostic,
  replica,
}) {
  return validateSchemaGoldenReferenceMigrationReplayObservation({
    schemaVersion: 1,
    status: REFERENCE_STATUS,
    contract,
    replica,
    localMigrationReplayDiagnostic: diagnostic,
  })
}

export function serializeSchemaGoldenReferenceMigrationReplayObservation(
  value,
) {
  return `${JSON.stringify(
    validateSchemaGoldenReferenceMigrationReplayObservation(value),
  )}\n`
}

export function validateSchemaGoldenReferenceMigrationReplayFailureObservation(
  value,
  migrationBasenames,
) {
  if (
    !exactKeys(value, REFERENCE_FAILURE_OBSERVATION_KEYS) ||
    value.schemaVersion !== 1 ||
    value.status !== REFERENCE_FAILURE_STATUS ||
    !CONTRACTS.has(value.contract) ||
    !REPLICAS.has(value.replica)
  ) {
    throw new Error(
      'Schema Golden Reference replay failure observation is invalid',
    )
  }
  const diagnostic = validateLocalMigrationReplayFailureDiagnostic(
    value.localMigrationReplayFailureDiagnostic,
    migrationBasenames,
  )
  if (
    diagnostic.role !== 'reference' ||
    diagnostic.contract !== value.contract
  ) {
    throw new Error(
      'Schema Golden Reference replay failure observation is invalid',
    )
  }
  return {
    schemaVersion: 1,
    status: REFERENCE_FAILURE_STATUS,
    contract: value.contract,
    replica: value.replica,
    localMigrationReplayFailureDiagnostic: diagnostic,
  }
}

export function buildSchemaGoldenReferenceMigrationReplayFailureObservation({
  contract,
  diagnostic,
  migrationBasenames,
  replica,
}) {
  return validateSchemaGoldenReferenceMigrationReplayFailureObservation(
    {
      schemaVersion: 1,
      status: REFERENCE_FAILURE_STATUS,
      contract,
      replica,
      localMigrationReplayFailureDiagnostic: diagnostic,
    },
    migrationBasenames,
  )
}

export function serializeSchemaGoldenReferenceMigrationReplayFailureObservation(
  value,
  migrationBasenames,
) {
  return `${JSON.stringify(
    validateSchemaGoldenReferenceMigrationReplayFailureObservation(
      value,
      migrationBasenames,
    ),
  )}\n`
}

export function validateSchemaGoldenReferenceMigrationReplayObservationSequence(
  values,
) {
  if (!Array.isArray(values) || values.length > REFERENCE_SEQUENCE.length) {
    throw new Error('Schema Golden Reference replay sequence is invalid')
  }
  const observations = values.map((value) =>
    validateSchemaGoldenReferenceMigrationReplayObservation(value),
  )
  for (let index = 0; index < observations.length; index += 1) {
    const [contract, replica] = REFERENCE_SEQUENCE[index]
    const observation = observations[index]
    if (observation.contract !== contract || observation.replica !== replica) {
      throw new Error('Schema Golden Reference replay sequence is invalid')
    }
  }
  return observations
}

function resemblesSchemaGoldenReferenceMigrationReplayObservation(value) {
  return (
    resemblesSchemaGoldenReferenceMigrationReplayEnvelope(value) ||
    (value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.hasOwn(value, 'localMigrationReplayDiagnostic') &&
      Object.hasOwn(value, 'replica'))
  )
}

function resemblesSchemaGoldenReferenceMigrationReplayEnvelope(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.hasOwn(value, 'schemaVersion') &&
    Object.hasOwn(value, 'contract') &&
    Object.hasOwn(value, 'replica')
  )
}

function resemblesSchemaGoldenReferenceMigrationReplayFailureObservation(
  value,
) {
  return (
    resemblesSchemaGoldenReferenceMigrationReplayEnvelope(value) ||
    (value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.hasOwn(value, 'localMigrationReplayFailureDiagnostic') &&
      Object.hasOwn(value, 'replica'))
  )
}

function rawLineResemblesSchemaGoldenReferenceMigrationReplayObservation(line) {
  return (
    line.includes(REFERENCE_STATUS) || line.includes(REFERENCE_FAILURE_STATUS)
  )
}

function rawOutputContainsSchemaGoldenReferenceMigrationReplayObject(output) {
  const raw = String(output ?? '')
  let depth = 0
  let escaped = false
  let inString = false
  let objectStart = -1
  const startsWithExpectedStatus = (token) =>
    [STATUS, FAILURE_STATUS, REFERENCE_STATUS, REFERENCE_FAILURE_STATUS].some(
      (status) => {
        const boundedLength = Math.min(token.length, status.length * 6)
        for (let end = 1; end <= boundedLength; end += 1) {
          try {
            const decoded = JSON.parse(`"${token.slice(0, end)}"`)
            if (decoded === status) return true
            if (!status.startsWith(decoded)) return false
          } catch {
            // Continue until the current JSON escape is complete.
          }
        }
        return false
      },
    )
  const resemblesObservation = (candidate) => {
    const keys = new Set()
    let expectedStatus = false
    let candidateEscaped = false
    let candidateStringStart = -1
    for (let index = 0; index < candidate.length; index += 1) {
      const character = candidate[index]
      if (candidateStringStart >= 0) {
        if (character === '\n' || character === '\r') {
          candidateEscaped = false
          candidateStringStart = -1
        } else if (candidateEscaped) candidateEscaped = false
        else if (character === '\\') candidateEscaped = true
        else if (character === '"') {
          let next = index + 1
          while (/\s/u.test(candidate[next] ?? '')) next += 1
          if (candidate[next] === ':') {
            const token = candidate.slice(candidateStringStart + 1, index)
            try {
              const key = JSON.parse(`"${token}"`)
              keys.add(key)
              if (key === 'status') {
                let valueStart = next + 1
                while (/\s/u.test(candidate[valueStart] ?? '')) valueStart += 1
                if (candidate[valueStart] === '"') {
                  let valueEnd = valueStart + 1
                  let valueEscaped = false
                  while (valueEnd < candidate.length) {
                    const valueCharacter = candidate[valueEnd]
                    if (valueCharacter === '\n' || valueCharacter === '\r') {
                      break
                    }
                    if (valueEscaped) valueEscaped = false
                    else if (valueCharacter === '\\') valueEscaped = true
                    else if (valueCharacter === '"') break
                    valueEnd += 1
                  }
                  const valueToken = candidate.slice(valueStart + 1, valueEnd)
                  expectedStatus ||= startsWithExpectedStatus(valueToken)
                }
              }
            } catch {
              // Invalid JSON string keys cannot equal typed marker keys.
            }
          }
          candidateStringStart = -1
        }
      } else if (character === '"') {
        candidateStringStart = index
      }
    }
    return (
      expectedStatus ||
      (keys.has('schemaVersion') &&
        keys.has('contract') &&
        keys.has('replica')) ||
      (keys.has('schemaVersion') &&
        keys.has('role') &&
        keys.has('contract') &&
        keys.has('stage')) ||
      (keys.has('localMigrationReplayDiagnostic') && keys.has('replica')) ||
      (keys.has('localMigrationReplayFailureDiagnostic') &&
        keys.has('replica')) ||
      (keys.has('historySchemaExists') &&
        keys.has('historyRelationExists') &&
        keys.has('psqlQueryCompleted')) ||
      (keys.has('completedMigrationCount') &&
        keys.has('psqlExitCode') &&
        keys.has('sqlstate'))
    )
  }
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index]
    if (depth === 0 && character === '{') {
      escaped = false
      inString = false
      objectStart = index
      depth = 1
      continue
    }
    if (inString) {
      if (character === '\n' || character === '\r') {
        escaped = false
        inString = false
      } else if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') {
      inString = true
    } else if (character === '{') {
      depth += 1
    } else if (character === '}' && depth > 0) {
      depth -= 1
      if (
        depth === 0 &&
        resemblesObservation(raw.slice(objectStart, index + 1))
      ) {
        return true
      }
    }
  }
  if (depth > 0 && resemblesObservation(raw.slice(objectStart))) {
    return true
  }
  return false
}

export function parseSchemaGoldenReferenceMigrationReplayObservations(output) {
  const observations = []
  const residualLines = []
  for (const line of String(output ?? '').split(/\r?\n/u)) {
    const resemblesRawObservation =
      rawLineResemblesSchemaGoldenReferenceMigrationReplayObservation(line)
    let parsed
    try {
      parsed = JSON.parse(line)
    } catch {
      if (resemblesRawObservation) {
        throw new Error('Schema Golden Reference replay output is invalid')
      }
      residualLines.push(line)
      continue
    }
    const resemblesObservation =
      resemblesSchemaGoldenReferenceMigrationReplayObservation(parsed)
    if (line.length > 4096) {
      if (
        resemblesRawObservation ||
        parsed?.status === REFERENCE_STATUS ||
        resemblesObservation
      ) {
        throw new Error('Schema Golden Reference replay output is invalid')
      }
      residualLines.push(line)
      continue
    }
    if (parsed?.status !== REFERENCE_STATUS) {
      if (resemblesRawObservation || resemblesObservation) {
        throw new Error('Schema Golden Reference replay output is invalid')
      }
      residualLines.push(line)
      continue
    }
    const validated =
      validateSchemaGoldenReferenceMigrationReplayObservation(parsed)
    if (JSON.stringify(validated) !== line) {
      throw new Error('Schema Golden Reference replay output is not canonical')
    }
    observations.push(validated)
  }
  if (
    rawOutputContainsSchemaGoldenReferenceMigrationReplayObject(
      residualLines.join('\n'),
    )
  ) {
    throw new Error('Schema Golden Reference replay output is invalid')
  }
  return validateSchemaGoldenReferenceMigrationReplayObservationSequence(
    observations,
  )
}

function resemblesLocalMigrationReplayDiagnostic(value) {
  return (
    resemblesLocalMigrationReplayEnvelope(value) ||
    (value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.hasOwn(value, 'historySchemaExists') &&
      Object.hasOwn(value, 'historyRelationExists') &&
      Object.hasOwn(value, 'psqlQueryCompleted'))
  )
}

function resemblesLocalMigrationReplayEnvelope(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.hasOwn(value, 'schemaVersion') &&
    Object.hasOwn(value, 'role') &&
    Object.hasOwn(value, 'contract') &&
    Object.hasOwn(value, 'stage')
  )
}

function resemblesLocalMigrationReplayFailureDiagnostic(value) {
  return (
    resemblesLocalMigrationReplayEnvelope(value) ||
    (value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.hasOwn(value, 'completedMigrationCount') &&
      Object.hasOwn(value, 'psqlExitCode') &&
      Object.hasOwn(value, 'sqlstate'))
  )
}

export function parseLocalMigrationReplayOutcome(output, migrationBasenames) {
  const boundaries = []
  const failures = []
  const ordered = []
  const residualLines = []
  for (const line of String(output ?? '').split(/\r?\n/u)) {
    const resemblesRaw = line.includes(STATUS) || line.includes(FAILURE_STATUS)
    let parsed
    try {
      parsed = JSON.parse(line)
    } catch {
      if (resemblesRaw) {
        throw new Error('Local migration replay outcome is invalid')
      }
      residualLines.push(line)
      continue
    }
    const resemblesBoundary = resemblesLocalMigrationReplayDiagnostic(parsed)
    const resemblesFailure =
      resemblesLocalMigrationReplayFailureDiagnostic(parsed)
    if (line.length > 4096) {
      if (resemblesRaw || resemblesBoundary || resemblesFailure) {
        throw new Error('Local migration replay outcome is invalid')
      }
      residualLines.push(line)
      continue
    }
    if (parsed?.status === STATUS) {
      const validated = validateLocalMigrationReplayDiagnostic(parsed)
      if (JSON.stringify(validated) !== line) {
        throw new Error('Local migration replay outcome is not canonical')
      }
      boundaries.push(validated)
      ordered.push('boundary')
      continue
    }
    if (parsed?.status === FAILURE_STATUS) {
      const validated = validateLocalMigrationReplayFailureDiagnostic(
        parsed,
        migrationBasenames,
      )
      if (JSON.stringify(validated) !== line) {
        throw new Error('Local migration replay outcome is not canonical')
      }
      failures.push(validated)
      ordered.push('failure')
      continue
    }
    if (resemblesRaw || resemblesBoundary || resemblesFailure) {
      throw new Error('Local migration replay outcome is invalid')
    }
    residualLines.push(line)
  }
  if (
    rawOutputContainsSchemaGoldenReferenceMigrationReplayObject(
      residualLines.join('\n'),
    ) ||
    boundaries.length > 1 ||
    failures.length > 1 ||
    (ordered.indexOf('failure') >= 0 &&
      ordered.includes('boundary', ordered.indexOf('failure') + 1))
  ) {
    throw new Error('Local migration replay outcome is invalid')
  }
  const boundary = boundaries[0] ?? null
  const failure = failures[0] ?? null
  if (failure) {
    if (
      (failure.stage !== 'history_preflight' && boundary === null) ||
      (boundary !== null &&
        (boundary.role !== failure.role ||
          boundary.contract !== failure.contract))
    ) {
      throw new Error('Local migration replay outcome is invalid')
    }
  }
  return { boundary, failure }
}

export function parseLocalMigrationReplayFailureDiagnostic(
  output,
  migrationBasenames,
) {
  return parseLocalMigrationReplayOutcome(output, migrationBasenames).failure
}

export function parseSchemaGoldenReferenceMigrationReplayOutcome(
  output,
  migrationBasenamesByContract,
) {
  const contracts = requireMigrationBasenamesByContract(
    migrationBasenamesByContract,
  )
  const observations = []
  const failures = []
  const ordered = []
  const residualLines = []
  for (const line of String(output ?? '').split(/\r?\n/u)) {
    const resemblesRaw =
      line.includes(REFERENCE_STATUS) || line.includes(REFERENCE_FAILURE_STATUS)
    let parsed
    try {
      parsed = JSON.parse(line)
    } catch {
      if (resemblesRaw) {
        throw new Error('Schema Golden Reference replay outcome is invalid')
      }
      residualLines.push(line)
      continue
    }
    const resemblesObservation =
      resemblesSchemaGoldenReferenceMigrationReplayObservation(parsed)
    const resemblesFailure =
      resemblesSchemaGoldenReferenceMigrationReplayFailureObservation(parsed)
    if (line.length > 4096) {
      if (resemblesRaw || resemblesObservation || resemblesFailure) {
        throw new Error('Schema Golden Reference replay outcome is invalid')
      }
      residualLines.push(line)
      continue
    }
    if (parsed?.status === REFERENCE_STATUS) {
      const validated =
        validateSchemaGoldenReferenceMigrationReplayObservation(parsed)
      if (JSON.stringify(validated) !== line) {
        throw new Error(
          'Schema Golden Reference replay outcome is not canonical',
        )
      }
      observations.push(validated)
      ordered.push('boundary')
      continue
    }
    if (parsed?.status === REFERENCE_FAILURE_STATUS) {
      if (!CONTRACTS.has(parsed.contract)) {
        throw new Error('Schema Golden Reference replay outcome is invalid')
      }
      const validated =
        validateSchemaGoldenReferenceMigrationReplayFailureObservation(
          parsed,
          contracts[parsed.contract],
        )
      if (JSON.stringify(validated) !== line) {
        throw new Error(
          'Schema Golden Reference replay outcome is not canonical',
        )
      }
      failures.push(validated)
      ordered.push('failure')
      continue
    }
    if (resemblesRaw || resemblesObservation || resemblesFailure) {
      throw new Error('Schema Golden Reference replay outcome is invalid')
    }
    residualLines.push(line)
  }
  if (
    rawOutputContainsSchemaGoldenReferenceMigrationReplayObject(
      residualLines.join('\n'),
    ) ||
    failures.length > 1 ||
    (ordered.indexOf('failure') >= 0 &&
      ordered.includes('boundary', ordered.indexOf('failure') + 1))
  ) {
    throw new Error('Schema Golden Reference replay outcome is invalid')
  }
  const validatedObservations =
    validateSchemaGoldenReferenceMigrationReplayObservationSequence(
      observations,
    )
  const failureObservation = failures[0] ?? null
  if (failureObservation) {
    const pair = [failureObservation.contract, failureObservation.replica]
    const inner = failureObservation.localMigrationReplayFailureDiagnostic
    if (inner.stage === 'history_preflight') {
      const last = validatedObservations.at(-1)
      const next = REFERENCE_SEQUENCE[validatedObservations.length]
      const matchesLast =
        last && pair[0] === last.contract && pair[1] === last.replica
      const matchesNext = next && pair[0] === next[0] && pair[1] === next[1]
      if (!matchesLast && !matchesNext) {
        throw new Error('Schema Golden Reference replay outcome is invalid')
      }
    } else {
      const last = validatedObservations.at(-1)
      if (!last || pair[0] !== last.contract || pair[1] !== last.replica) {
        throw new Error('Schema Golden Reference replay outcome is invalid')
      }
    }
  }
  return {
    observations: validatedObservations,
    failureObservation,
  }
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
