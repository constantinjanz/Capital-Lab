const STATUS = 'local_migration_replay_boundary_observed'
const REFERENCE_STATUS = 'schema_golden_reference_migration_replay_observed'
const STAGE = 'history_preflight'
const ROLES = new Set(['reference', 'source'])
const CONTRACTS = new Set(['post', 'pre'])
const REPLICAS = new Set(['a', 'b'])
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
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.hasOwn(value, 'localMigrationReplayDiagnostic') &&
    Object.hasOwn(value, 'replica')
  )
}

function rawLineResemblesSchemaGoldenReferenceMigrationReplayObservation(line) {
  return line.includes(REFERENCE_STATUS)
}

function rawOutputContainsSchemaGoldenReferenceMigrationReplayObject(output) {
  const raw = String(output ?? '')
  let depth = 0
  let escaped = false
  let inString = false
  let objectStart = -1
  const startsWithExpectedStatus = (token) => {
    const boundedLength = Math.min(token.length, REFERENCE_STATUS.length * 6)
    for (let end = 1; end <= boundedLength; end += 1) {
      try {
        const decoded = JSON.parse(`"${token.slice(0, end)}"`)
        if (decoded === REFERENCE_STATUS) return true
        if (!REFERENCE_STATUS.startsWith(decoded)) return false
      } catch {
        // Continue until the current JSON escape is complete.
      }
    }
    return false
  }
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
      (keys.has('localMigrationReplayDiagnostic') && keys.has('replica'))
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
