import { constants as osConstants } from 'node:os'

export const LOCAL_ROLLBACK_REHEARSAL_FAILURE_STATUS =
  'local_rollback_migration_rehearsal_failure_observed'
export const LOCAL_ROLLBACK_REHEARSAL_SUCCESS_STATUS = 'rollback_verified'
export const LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PREFIX =
  'CAPITAL_LAB_CLIENT_STAGE_MARKER:ROLLBACK_REHEARSAL:'

export const ROLLBACK_MIGRATION_BASENAMES = Object.freeze([
  '20260809150000_post_build_hosting_safety.sql',
  '20260809150417_activation_readiness_follow_up.sql',
  '20260812092043_fourth_activation_readiness_remediation.sql',
  '20260812140953_fourth_activation_readiness_review_closure.sql',
])

function frozenMarker(stage, migrationBasename, completedMigrationCount) {
  return Object.freeze({ stage, migrationBasename, completedMigrationCount })
}

export const LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN = Object.freeze([
  frozenMarker('history_baseline', null, 0),
  ...ROLLBACK_MIGRATION_BASENAMES.map((migrationBasename, index) =>
    frozenMarker('migration_body', migrationBasename, index),
  ),
  frozenMarker('probe', null, 4),
  frozenMarker('rollback_verification', null, 4),
])

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
const FAILURE_BUILD_KEYS = [
  'completedMigrationCount',
  'migrationBasename',
  'psqlExitCode',
  'signal',
  'sqlstate',
  'stage',
  'timedOut',
]
const STAGE_MARKER_KEYS = [
  'completedMigrationCount',
  'migrationBasename',
  'stage',
]
const SUCCESS_KEYS = [
  'commitSha',
  'migrationCount',
  'migrationSetSha256',
  'status',
]
const SUCCESS_BUILD_KEYS = ['commitSha', 'migrationSetSha256']
const SUCCESS_EXPECTED_KEYS = [
  'expectedCommitSha',
  'expectedMigrationSetSha256',
]
const COMMIT_SHA = /^[0-9a-f]{40}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const SQLSTATE = /^[0-9A-Z]{5}$/u
const ASCII_IDENTIFIER = /^[A-Za-z0-9_]+$/u
const MAX_TYPED_OUTPUT_SCAN_LENGTH = 64 * 1024
const SIGNALS = new Set(Object.keys(osConstants.signals))

function matchesString(pattern, value) {
  return typeof value === 'string' && pattern.test(value)
}

function exactKeys(value, expected) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join('\n') === [...expected].sort().join('\n')
  )
}

function markerPlanIndex(value) {
  return LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN.findIndex(
    (marker) =>
      marker.stage === value.stage &&
      marker.migrationBasename === value.migrationBasename &&
      marker.completedMigrationCount === value.completedMigrationCount,
  )
}

export function validateLocalRollbackRehearsalStageMarker(value) {
  if (!exactKeys(value, STAGE_MARKER_KEYS) || markerPlanIndex(value) < 0) {
    throw new Error('Local rollback rehearsal stage marker is invalid')
  }
  return {
    stage: value.stage,
    migrationBasename: value.migrationBasename,
    completedMigrationCount: value.completedMigrationCount,
  }
}

export function serializeLocalRollbackRehearsalStageMarker(value) {
  const marker = validateLocalRollbackRehearsalStageMarker(value)
  const index = markerPlanIndex(marker)
  return `${LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PREFIX}${index}:${marker.stage}:${marker.completedMigrationCount}:${marker.migrationBasename ?? '-'}\n`
}

export function localRollbackRehearsalStageMarkerPsqlCommand(value) {
  return `\\warn ${serializeLocalRollbackRehearsalStageMarker(value)}`
}

function markerParseStart(options) {
  if (
    !exactKeys(options, ['expectedStartIndex']) ||
    (options.expectedStartIndex !== 0 && options.expectedStartIndex !== 1)
  ) {
    throw new Error('Local rollback rehearsal marker parser context is invalid')
  }
  return options.expectedStartIndex
}

function markerPlanForStart(expectedStartIndex) {
  return expectedStartIndex === 0
    ? LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN.slice(0, 1)
    : LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN.slice(1)
}

export function buildLocalRollbackRehearsalClientStageMarkerPlan(
  options = { expectedStartIndex: 0 },
) {
  const expectedStartIndex = markerParseStart(options)
  return Object.freeze({
    prefix: LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PREFIX,
    markers: Object.freeze(
      markerPlanForStart(expectedStartIndex).map((marker) =>
        serializeLocalRollbackRehearsalStageMarker(marker).trimEnd(),
      ),
    ),
  })
}

export function localRollbackRehearsalStageMarkerFromClientIndex(
  lastClientStageMarkerIndex,
  options = { expectedStartIndex: 0 },
) {
  const expectedStartIndex = markerParseStart(options)
  if (
    !Number.isSafeInteger(lastClientStageMarkerIndex) ||
    lastClientStageMarkerIndex < 0
  ) {
    throw new Error('Local rollback rehearsal client marker index is invalid')
  }
  const marker =
    markerPlanForStart(expectedStartIndex)[lastClientStageMarkerIndex]
  if (!marker) {
    throw new Error('Local rollback rehearsal client marker index is invalid')
  }
  return validateLocalRollbackRehearsalStageMarker(marker)
}

export function parseLocalRollbackRehearsalStageMarkers(
  output,
  options = { expectedStartIndex: 0 },
) {
  const expectedStartIndex = markerParseStart(options)
  const markers = []
  for (const line of String(output ?? '').split(/\r?\n/u)) {
    if (!line.includes(LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PREFIX)) continue
    if (line.length > 512) {
      throw new Error('Local rollback rehearsal stage marker is invalid')
    }
    const parts = line
      .slice(LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PREFIX.length)
      .split(':')
    if (
      !line.startsWith(LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PREFIX) ||
      parts.length !== 4 ||
      !/^(?:0|[1-9][0-9]*)$/u.test(parts[0])
    ) {
      throw new Error('Local rollback rehearsal stage marker is invalid')
    }
    const index = Number(parts[0])
    const planned = LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN[index]
    if (
      !planned ||
      line !== serializeLocalRollbackRehearsalStageMarker(planned).trimEnd()
    ) {
      throw new Error('Local rollback rehearsal stage marker is invalid')
    }
    markers.push(validateLocalRollbackRehearsalStageMarker(planned))
  }
  if (markers.length > markerPlanForStart(expectedStartIndex).length) {
    throw new Error('Local rollback rehearsal stage marker sequence is invalid')
  }
  for (let offset = 0; offset < markers.length; offset += 1) {
    const expected = markerPlanForStart(expectedStartIndex)[offset]
    if (markerPlanIndex(markers[offset]) !== markerPlanIndex(expected)) {
      throw new Error(
        'Local rollback rehearsal stage marker sequence is invalid',
      )
    }
  }
  return markers
}

export function requireLastLocalRollbackRehearsalStageMarker(output, options) {
  const markers = parseLocalRollbackRehearsalStageMarkers(output, options)
  if (markers.length === 0) {
    throw new Error('Local rollback rehearsal stage marker is missing')
  }
  return markers.at(-1)
}

function validFailureProcessOutcome(value) {
  const exitCodeValid =
    value.psqlExitCode === null ||
    (Number.isSafeInteger(value.psqlExitCode) && value.psqlExitCode > 0)
  const signalValid =
    value.signal === null ||
    (typeof value.signal === 'string' && SIGNALS.has(value.signal))
  if (!exitCodeValid || !signalValid || typeof value.timedOut !== 'boolean') {
    return false
  }

  const normalNonzeroPsqlExit =
    value.psqlExitCode !== null &&
    value.signal === null &&
    value.timedOut === false
  if (normalNonzeroPsqlExit) return matchesString(SQLSTATE, value.sqlstate)

  if (value.psqlExitCode !== null || value.sqlstate !== null) return false

  const logicalValidationFailure =
    value.signal === null && value.timedOut === false
  return (
    !logicalValidationFailure ||
    value.stage === 'history_baseline' ||
    value.stage === 'rollback_verification'
  )
}

export function validateLocalRollbackMigrationRehearsalFailureDiagnostic(
  value,
) {
  if (
    !exactKeys(value, FAILURE_KEYS) ||
    value.schemaVersion !== 1 ||
    value.status !== LOCAL_ROLLBACK_REHEARSAL_FAILURE_STATUS ||
    value.role !== 'source' ||
    value.contract !== 'pre' ||
    !Number.isSafeInteger(value.completedMigrationCount) ||
    !validFailureProcessOutcome(value) ||
    markerPlanIndex(value) < 0
  ) {
    throw new Error(
      'Local rollback migration rehearsal failure diagnostic is invalid',
    )
  }
  return {
    schemaVersion: 1,
    status: LOCAL_ROLLBACK_REHEARSAL_FAILURE_STATUS,
    role: 'source',
    contract: 'pre',
    stage: value.stage,
    migrationBasename: value.migrationBasename,
    completedMigrationCount: value.completedMigrationCount,
    psqlExitCode: value.psqlExitCode,
    sqlstate: value.sqlstate,
    signal: value.signal,
    timedOut: value.timedOut,
  }
}

export function buildLocalRollbackMigrationRehearsalFailureDiagnostic(input) {
  if (!exactKeys(input, FAILURE_BUILD_KEYS)) {
    throw new Error(
      'Local rollback migration rehearsal failure input is invalid',
    )
  }
  return validateLocalRollbackMigrationRehearsalFailureDiagnostic({
    schemaVersion: 1,
    status: LOCAL_ROLLBACK_REHEARSAL_FAILURE_STATUS,
    role: 'source',
    contract: 'pre',
    stage: input.stage,
    migrationBasename: input.migrationBasename,
    completedMigrationCount: input.completedMigrationCount,
    psqlExitCode: input.psqlExitCode,
    sqlstate: input.sqlstate,
    signal: input.signal,
    timedOut: input.timedOut,
  })
}

function decodedJsonStrings(raw) {
  const decoded = []
  let start = -1
  let escaped = false
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index]
    if (start < 0) {
      if (character === '"') start = index
      continue
    }
    if (character === '\n' || character === '\r') {
      start = -1
      escaped = false
    } else if (escaped) {
      escaped = false
    } else if (character === '\\') {
      escaped = true
    } else if (character === '"') {
      try {
        decoded.push(JSON.parse(raw.slice(start, index + 1)))
      } catch {
        // Invalid JSON strings cannot equal a typed marker or signature key.
      }
      start = -1
    }
  }
  return decoded
}

function rawResemblesTypedObject(raw, status, signatureKeys) {
  if (
    raw.length > MAX_TYPED_OUTPUT_SCAN_LENGTH ||
    raw.includes(status.slice(0, -1)) ||
    rawContainsEncodedAsciiIdentifier(raw, status)
  ) {
    return true
  }
  const tokens = new Set(decodedJsonStrings(raw))
  return tokens.has(status) || signatureKeys.every((key) => tokens.has(key))
}

function parsedResemblesTypedObject(value, signatureKeys) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    signatureKeys.every((key) => Object.hasOwn(value, key))
  )
}

function matchesEncodedAsciiIdentifierAt(raw, start, identifier) {
  let cursor = start
  for (const expected of identifier) {
    if (raw[cursor] === expected) {
      cursor += 1
      continue
    }
    if (raw[cursor] !== '\\' || raw[cursor + 1] !== 'u') return false

    const hexadecimal = raw.slice(cursor + 2, cursor + 6)
    if (!/^[0-9A-Fa-f]{4}$/u.test(hexadecimal)) return false
    const decoded = String.fromCharCode(Number.parseInt(hexadecimal, 16))
    if (!ASCII_IDENTIFIER.test(decoded) || decoded !== expected) return false
    cursor += 6
  }
  return true
}

function rawContainsEncodedAsciiIdentifier(raw, identifier) {
  if (!ASCII_IDENTIFIER.test(identifier) || identifier.length > 128) {
    return false
  }
  for (let start = 0; start < raw.length; start += 1) {
    if (matchesEncodedAsciiIdentifierAt(raw, start, identifier)) return true
  }
  return false
}

function parseCanonicalTypedObject(
  output,
  { status, signatureKeys, validate, invalidMessage },
) {
  const rawOutput = String(output ?? '')
  if (rawOutput.length > MAX_TYPED_OUTPUT_SCAN_LENGTH) {
    throw new Error(invalidMessage)
  }
  const candidates = []
  const residual = []
  for (const line of rawOutput.split(/\r?\n/u)) {
    let parsed
    try {
      parsed = JSON.parse(line)
    } catch {
      residual.push(line)
      continue
    }
    if (parsed?.status !== status) {
      if (parsedResemblesTypedObject(parsed, signatureKeys)) {
        throw new Error(invalidMessage)
      }
      residual.push(line)
      continue
    }
    if (line.length > 4096) throw new Error(invalidMessage)
    const validated = validate(parsed)
    if (JSON.stringify(validated) !== line) {
      throw new Error(`${invalidMessage} is not canonical`)
    }
    candidates.push(validated)
  }
  if (
    candidates.length > 1 ||
    rawResemblesTypedObject(residual.join('\n'), status, signatureKeys)
  ) {
    throw new Error(invalidMessage)
  }
  return candidates[0] ?? null
}

export function serializeLocalRollbackMigrationRehearsalFailureDiagnostic(
  value,
) {
  return `${JSON.stringify(
    validateLocalRollbackMigrationRehearsalFailureDiagnostic(value),
  )}\n`
}

export function parseLocalRollbackMigrationRehearsalFailureDiagnostic(output) {
  return parseCanonicalTypedObject(output, {
    status: LOCAL_ROLLBACK_REHEARSAL_FAILURE_STATUS,
    signatureKeys: [
      'completedMigrationCount',
      'migrationBasename',
      'psqlExitCode',
    ],
    validate: validateLocalRollbackMigrationRehearsalFailureDiagnostic,
    invalidMessage:
      'Local rollback migration rehearsal failure diagnostic output is invalid',
  })
}

export function requireLocalRollbackMigrationRehearsalFailureDiagnostic(
  output,
) {
  const diagnostic =
    parseLocalRollbackMigrationRehearsalFailureDiagnostic(output)
  if (!diagnostic) {
    throw new Error(
      'Local rollback migration rehearsal failure diagnostic output is missing',
    )
  }
  return diagnostic
}

function validateSuccessExpectations(expected) {
  if (
    expected === null ||
    typeof expected !== 'object' ||
    Array.isArray(expected) ||
    Object.keys(expected).some((key) => !SUCCESS_EXPECTED_KEYS.includes(key)) ||
    (expected.expectedCommitSha !== undefined &&
      !matchesString(COMMIT_SHA, expected.expectedCommitSha)) ||
    (expected.expectedMigrationSetSha256 !== undefined &&
      !matchesString(SHA256, expected.expectedMigrationSetSha256))
  ) {
    throw new Error('Local rollback rehearsal success context is invalid')
  }
  return expected
}

export function validateLocalRollbackMigrationRehearsalSuccess(
  value,
  expected = {},
) {
  const context = validateSuccessExpectations(expected)
  if (
    !exactKeys(value, SUCCESS_KEYS) ||
    value.status !== LOCAL_ROLLBACK_REHEARSAL_SUCCESS_STATUS ||
    !matchesString(COMMIT_SHA, value.commitSha) ||
    value.migrationCount !== ROLLBACK_MIGRATION_BASENAMES.length ||
    !matchesString(SHA256, value.migrationSetSha256) ||
    (context.expectedCommitSha !== undefined &&
      value.commitSha !== context.expectedCommitSha) ||
    (context.expectedMigrationSetSha256 !== undefined &&
      value.migrationSetSha256 !== context.expectedMigrationSetSha256)
  ) {
    throw new Error('Local rollback migration rehearsal success is invalid')
  }
  return {
    commitSha: value.commitSha,
    migrationCount: ROLLBACK_MIGRATION_BASENAMES.length,
    migrationSetSha256: value.migrationSetSha256,
    status: LOCAL_ROLLBACK_REHEARSAL_SUCCESS_STATUS,
  }
}

export function buildLocalRollbackMigrationRehearsalSuccess(input) {
  if (!exactKeys(input, SUCCESS_BUILD_KEYS)) {
    throw new Error(
      'Local rollback migration rehearsal success input is invalid',
    )
  }
  return validateLocalRollbackMigrationRehearsalSuccess({
    commitSha: input.commitSha,
    migrationCount: ROLLBACK_MIGRATION_BASENAMES.length,
    migrationSetSha256: input.migrationSetSha256,
    status: LOCAL_ROLLBACK_REHEARSAL_SUCCESS_STATUS,
  })
}

export function serializeLocalRollbackMigrationRehearsalSuccess(
  value,
  expected,
) {
  return `${JSON.stringify(
    validateLocalRollbackMigrationRehearsalSuccess(value, expected),
  )}\n`
}

export function parseLocalRollbackMigrationRehearsalSuccess(output, expected) {
  return parseCanonicalTypedObject(output, {
    status: LOCAL_ROLLBACK_REHEARSAL_SUCCESS_STATUS,
    signatureKeys: ['commitSha', 'migrationCount', 'migrationSetSha256'],
    validate: (value) =>
      validateLocalRollbackMigrationRehearsalSuccess(value, expected),
    invalidMessage:
      'Local rollback migration rehearsal success output is invalid',
  })
}

export function requireLocalRollbackMigrationRehearsalSuccess(
  output,
  expected,
) {
  const success = parseLocalRollbackMigrationRehearsalSuccess(output, expected)
  if (!success) {
    throw new Error(
      'Local rollback migration rehearsal success output is missing',
    )
  }
  return success
}
