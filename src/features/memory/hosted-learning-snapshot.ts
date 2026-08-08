import {
  decimal,
  decimalValue,
  type FinancialDecimal,
} from '@/domain/financial/decimal'
import { HOSTED_PATTERN_PROMOTION_POLICY_V1 } from '@/domain/memory/patterns'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CONTENT_HASH_PATTERN = /^[0-9a-f]{64}$/
const COUNT_PATTERN = /^(0|[1-9][0-9]*)$/
const MAX_BIGINT = BigInt('9223372036854775807')
const MAX_PATTERNS = 200
const MAX_ASSIGNMENTS = 200

const decisionTypes = new Set([
  'buy',
  'sell',
  'sell_short',
  'buy_to_cover',
  'reduce',
  'close',
  'hold',
  'abstain',
])
const evidenceKinds = new Set([
  'quote',
  'bar',
  'event',
  'knowledge',
  'prior_decision',
])
const outcomeHorizons = new Set(['15m', '1h', 'eod', '1d', '5d'])
const patternStatuses = new Set([
  'proposed',
  'shadow',
  'eligible',
  'active',
  'rejected',
  'retired',
])
const assignmentTypes = new Set(['champion', 'challenger'])
const patternGateReasonCodes = new Set([
  'POLICY_CONFIG_MISMATCH',
  'INSUFFICIENT_INDEPENDENT_OBSERVATIONS',
  'HIT_RATE_UNAVAILABLE',
  'HIT_RATE_BELOW_THRESHOLD',
  'BENCHMARK_RELATIVE_RETURN_UNAVAILABLE',
  'BENCHMARK_RELATIVE_RETURN_BELOW_THRESHOLD',
  'ADVERSE_EXCURSION_UNAVAILABLE',
  'ADVERSE_EXCURSION_BELOW_LIMIT',
  'HOLDOUT_NOT_PASSED',
])

type UnknownRow = Record<string, unknown>

export type HostedLearningDecisionType =
  | 'buy'
  | 'sell'
  | 'sell_short'
  | 'buy_to_cover'
  | 'reduce'
  | 'close'
  | 'hold'
  | 'abstain'

export type HostedLearningEvidenceKind =
  'quote' | 'bar' | 'event' | 'knowledge' | 'prior_decision'

export type HostedLearningHorizon = '15m' | '1h' | 'eod' | '1d' | '5d'
export type HostedPatternLifecycleStatus =
  'proposed' | 'shadow' | 'eligible' | 'active' | 'rejected' | 'retired'
export type HostedStrategyAssignmentType = 'champion' | 'challenger'

export interface HostedCalibrationStatistic {
  bandIndex: number
  bandLower: string
  bandUpper: string
  decisionCount: string
  evaluatedCount: string
  meanConfidence: string | null
  observedHitRate: string | null
}

export interface HostedDecisionCategoryStatistic {
  decisionType: HostedLearningDecisionType
  decisionCount: string
  evaluatedCount: string
  meanConfidence: string | null
  hitRate: string | null
  meanForwardReturn: string | null
  meanBenchmarkRelativeReturn: string | null
}

export interface HostedEvidenceKindStatistic {
  evidenceKind: HostedLearningEvidenceKind
  citationCount: string
  decisionCount: string
}

export interface HostedOutcomeHorizonStatistic {
  horizon: HostedLearningHorizon
  outcomeCount: string
  hitRate: string
  meanForwardReturn: string
  meanBenchmarkRelativeReturn: string
  maximumFavorableExcursion: string
  worstMaximumAdverseExcursion: string
}

export interface HostedPatternStatistic {
  id: string
  experimentId: string
  name: string
  hypothesis: string
  lifecycleStatus: HostedPatternLifecycleStatus
  proposedAt: string
  updatedAt: string
  createdAt: string
  policyVersion: string
  independentObservations: string
  hitRate: string | null
  meanBenchmarkRelativeReturn: string | null
  worstMaximumAdverseExcursion: string | null
  holdoutPassed: boolean
  policyMatches: boolean
  eligible: boolean
  reasons: string[]
}

export interface HostedStrategyAssignment {
  id: string
  experimentId: string
  strategyVersionId: string
  strategyName: string
  strategyVersion: number
  strategyContentHash: string
  assignmentType: HostedStrategyAssignmentType
  allocationFraction: string
  validFrom: string
  validTo: string | null
  promotionEvidence: UnknownRow
  createdAt: string
}

export interface HostedLearningSnapshot {
  source: 'supabase'
  decisionAt: string
  calibration: HostedCalibrationStatistic[]
  categories: HostedDecisionCategoryStatistic[]
  evidenceKinds: HostedEvidenceKindStatistic[]
  horizons: HostedOutcomeHorizonStatistic[]
  patterns: HostedPatternStatistic[]
  assignments: HostedStrategyAssignment[]
}

function row(value: unknown, label: string): UnknownRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Hosted learning snapshot has an invalid ${label}`)
  }
  return value as UnknownRow
}

function rows(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Hosted learning snapshot has invalid ${label}`)
  }
  return value
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Hosted learning snapshot has an invalid ${label}`)
  }
  return value
}

function uuid(value: unknown, label: string): string {
  const result = text(value, label)
  if (!UUID_PATTERN.test(result)) {
    throw new Error(`Hosted learning snapshot has an invalid ${label}`)
  }
  return result
}

function timestamp(value: unknown, label: string): string {
  const result = text(value, label)
  if (!Number.isFinite(Date.parse(result))) {
    throw new Error(`Hosted learning snapshot has an invalid ${label}`)
  }
  return result
}

function nullableTimestamp(value: unknown, label: string): string | null {
  return value === null ? null : timestamp(value, label)
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`Hosted learning snapshot has an invalid ${label}`)
  }
  return value
}

function integer(
  value: unknown,
  label: string,
  minimum: number,
  maximum?: number,
): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < minimum ||
    (maximum !== undefined && (value as number) > maximum)
  ) {
    throw new Error(`Hosted learning snapshot has an invalid ${label}`)
  }
  return value as number
}

function count(value: unknown, label: string): string {
  if (typeof value !== 'string' || !COUNT_PATTERN.test(value)) {
    throw new Error(`Hosted learning snapshot has an invalid ${label}`)
  }
  if (BigInt(value) > MAX_BIGINT) {
    throw new Error(`Hosted learning snapshot has an invalid ${label}`)
  }
  return value
}

function exactDecimal(
  value: unknown,
  label: string,
  validate?: (candidate: FinancialDecimal) => boolean,
): string {
  if (typeof value !== 'string') {
    throw new Error(`Hosted learning snapshot has an invalid ${label}`)
  }
  try {
    const parsed = decimal(value)
    if (validate && !validate(parsed)) throw new Error('range')
    return decimalValue(parsed)
  } catch {
    throw new Error(`Hosted learning snapshot has an invalid ${label}`)
  }
}

function nullableExactDecimal(
  value: unknown,
  label: string,
  validate?: (candidate: FinancialDecimal) => boolean,
): string | null {
  return value === null ? null : exactDecimal(value, label, validate)
}

function enumValue<T extends string>(
  value: unknown,
  allowed: ReadonlySet<string>,
  label: string,
): T {
  const result = text(value, label)
  if (!allowed.has(result)) {
    throw new Error(`Hosted learning snapshot has an invalid ${label}`)
  }
  return result as T
}

function contentHash(value: unknown, label: string): string {
  const result = text(value, label)
  if (!CONTENT_HASH_PATTERN.test(result)) {
    throw new Error(`Hosted learning snapshot has an invalid ${label}`)
  }
  return result
}

function atOrBefore(value: string, boundary: string, label: string): void {
  if (Date.parse(value) > Date.parse(boundary)) {
    throw new Error(`Hosted learning snapshot has a future ${label}`)
  }
}

function sameInstant(left: string, right: string, label: string): void {
  if (Date.parse(left) !== Date.parse(right)) {
    throw new Error(`Hosted learning snapshot has an inconsistent ${label}`)
  }
}

function assertOwner(value: unknown, ownerId: string): void {
  if (uuid(value, 'owner id') !== ownerId) {
    throw new Error('Hosted learning snapshot crossed the owner boundary')
  }
}

function assertUnique<T>(
  values: T[],
  key: (value: T) => string,
  label: string,
): void {
  const seen = new Set<string>()
  for (const value of values) {
    const candidate = key(value)
    if (seen.has(candidate)) {
      throw new Error(`Hosted learning snapshot has duplicate ${label}`)
    }
    seen.add(candidate)
  }
}

function policyMatches(value: unknown): boolean {
  const input = row(value, 'pattern policy')
  const keys = Object.keys(input).sort()
  const expectedKeys = [
    'minimumAllowedMaximumAdverseExcursion',
    'minimumHitRate',
    'minimumIndependentObservations',
    'minimumMeanBenchmarkRelativeReturn',
    'policyVersion',
    'requireHoldout',
  ]
  return (
    keys.length === expectedKeys.length &&
    keys.every((key, index) => key === expectedKeys[index]) &&
    input.policyVersion === HOSTED_PATTERN_PROMOTION_POLICY_V1.version &&
    input.minimumIndependentObservations ===
      HOSTED_PATTERN_PROMOTION_POLICY_V1.minimumIndependentObservations &&
    input.minimumHitRate ===
      HOSTED_PATTERN_PROMOTION_POLICY_V1.minimumHitRate &&
    input.minimumMeanBenchmarkRelativeReturn ===
      HOSTED_PATTERN_PROMOTION_POLICY_V1.minimumMeanBenchmarkRelativeReturn &&
    input.minimumAllowedMaximumAdverseExcursion ===
      HOSTED_PATTERN_PROMOTION_POLICY_V1.minimumAllowedMaximumAdverseExcursion &&
    input.requireHoldout === HOSTED_PATTERN_PROMOTION_POLICY_V1.requireHoldout
  )
}

function gateReasons(value: unknown, label: string): string[] {
  const result = rows(value, label).map((reason) => text(reason, label))
  if (
    new Set(result).size !== result.length ||
    result.some((reason) => !patternGateReasonCodes.has(reason))
  ) {
    throw new Error('Hosted learning snapshot has invalid pattern gate reasons')
  }
  return result
}

function expectedGateReasons(input: {
  policyMatches: boolean
  independentObservations: string
  hitRate: string | null
  meanBenchmarkRelativeReturn: string | null
  worstMaximumAdverseExcursion: string | null
  holdoutPassed: boolean
}): string[] {
  const reasons: string[] = []
  if (!input.policyMatches) reasons.push('POLICY_CONFIG_MISMATCH')
  if (
    BigInt(input.independentObservations) <
    BigInt(HOSTED_PATTERN_PROMOTION_POLICY_V1.minimumIndependentObservations)
  ) {
    reasons.push('INSUFFICIENT_INDEPENDENT_OBSERVATIONS')
  }
  if (input.hitRate === null) reasons.push('HIT_RATE_UNAVAILABLE')
  else if (
    decimal(input.hitRate).lt(HOSTED_PATTERN_PROMOTION_POLICY_V1.minimumHitRate)
  ) {
    reasons.push('HIT_RATE_BELOW_THRESHOLD')
  }
  if (input.meanBenchmarkRelativeReturn === null) {
    reasons.push('BENCHMARK_RELATIVE_RETURN_UNAVAILABLE')
  } else if (
    decimal(input.meanBenchmarkRelativeReturn).lt(
      HOSTED_PATTERN_PROMOTION_POLICY_V1.minimumMeanBenchmarkRelativeReturn,
    )
  ) {
    reasons.push('BENCHMARK_RELATIVE_RETURN_BELOW_THRESHOLD')
  }
  if (input.worstMaximumAdverseExcursion === null) {
    reasons.push('ADVERSE_EXCURSION_UNAVAILABLE')
  } else if (
    decimal(input.worstMaximumAdverseExcursion).lt(
      HOSTED_PATTERN_PROMOTION_POLICY_V1.minimumAllowedMaximumAdverseExcursion,
    )
  ) {
    reasons.push('ADVERSE_EXCURSION_BELOW_LIMIT')
  }
  if (!input.holdoutPassed) reasons.push('HOLDOUT_NOT_PASSED')
  return reasons
}

function sameStrings(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}

function mapCalibration(value: unknown): HostedCalibrationStatistic {
  const input = row(value, 'calibration row')
  const bandIndex = integer(input.band_index, 'calibration band', 0, 4)
  const bandLower = exactDecimal(
    input.band_lower_text,
    'calibration lower bound',
    (candidate) => candidate.gte(0) && candidate.lte(1),
  )
  const bandUpper = exactDecimal(
    input.band_upper_text,
    'calibration upper bound',
    (candidate) => candidate.gte(0) && candidate.lte(1),
  )
  if (
    !decimal(bandLower).eq(decimal(String(bandIndex)).mul('0.2')) ||
    !decimal(bandUpper).eq(decimal(String(bandIndex + 1)).mul('0.2'))
  ) {
    throw new Error(
      'Hosted learning snapshot has inconsistent calibration bounds',
    )
  }
  const decisionCount = count(input.decision_count_text, 'decision count')
  const evaluatedCount = count(input.evaluated_count_text, 'evaluated count')
  if (BigInt(evaluatedCount) > BigInt(decisionCount)) {
    throw new Error(
      'Hosted learning snapshot has inconsistent calibration counts',
    )
  }
  return {
    bandIndex,
    bandLower,
    bandUpper,
    decisionCount,
    evaluatedCount,
    meanConfidence: nullableExactDecimal(
      input.mean_confidence_text,
      'mean confidence',
      (candidate) => candidate.gte(0) && candidate.lte(1),
    ),
    observedHitRate: nullableExactDecimal(
      input.observed_hit_rate_text,
      'observed hit rate',
      (candidate) => candidate.gte(0) && candidate.lte(1),
    ),
  }
}

function mapCategory(value: unknown): HostedDecisionCategoryStatistic {
  const input = row(value, 'decision category row')
  const decisionCount = count(input.decision_count_text, 'decision count')
  const evaluatedCount = count(input.evaluated_count_text, 'evaluated count')
  if (BigInt(evaluatedCount) > BigInt(decisionCount)) {
    throw new Error('Hosted learning snapshot has inconsistent category counts')
  }
  return {
    decisionType: enumValue<HostedLearningDecisionType>(
      input.decision_type,
      decisionTypes,
      'decision type',
    ),
    decisionCount,
    evaluatedCount,
    meanConfidence: nullableExactDecimal(
      input.mean_confidence_text,
      'mean confidence',
      (candidate) => candidate.gte(0) && candidate.lte(1),
    ),
    hitRate: nullableExactDecimal(
      input.hit_rate_text,
      'hit rate',
      (candidate) => candidate.gte(0) && candidate.lte(1),
    ),
    meanForwardReturn: nullableExactDecimal(
      input.mean_forward_return_text,
      'mean forward return',
    ),
    meanBenchmarkRelativeReturn: nullableExactDecimal(
      input.mean_benchmark_relative_return_text,
      'mean benchmark-relative return',
    ),
  }
}

function mapEvidenceKind(value: unknown): HostedEvidenceKindStatistic {
  const input = row(value, 'evidence kind row')
  const citationCount = count(input.citation_count_text, 'citation count')
  const decisionCount = count(input.decision_count_text, 'decision count')
  if (BigInt(decisionCount) > BigInt(citationCount)) {
    throw new Error('Hosted learning snapshot has inconsistent evidence counts')
  }
  return {
    evidenceKind: enumValue<HostedLearningEvidenceKind>(
      input.evidence_kind,
      evidenceKinds,
      'evidence kind',
    ),
    citationCount,
    decisionCount,
  }
}

function mapHorizon(value: unknown): HostedOutcomeHorizonStatistic {
  const input = row(value, 'outcome horizon row')
  return {
    horizon: enumValue<HostedLearningHorizon>(
      input.horizon,
      outcomeHorizons,
      'outcome horizon',
    ),
    outcomeCount: count(input.outcome_count_text, 'outcome count'),
    hitRate: exactDecimal(
      input.hit_rate_text,
      'hit rate',
      (candidate) => candidate.gte(0) && candidate.lte(1),
    ),
    meanForwardReturn: exactDecimal(
      input.mean_forward_return_text,
      'mean forward return',
    ),
    meanBenchmarkRelativeReturn: exactDecimal(
      input.mean_benchmark_relative_return_text,
      'mean benchmark-relative return',
    ),
    maximumFavorableExcursion: exactDecimal(
      input.maximum_favorable_excursion_text,
      'maximum favorable excursion',
      (candidate) => candidate.gte(0),
    ),
    worstMaximumAdverseExcursion: exactDecimal(
      input.worst_maximum_adverse_excursion_text,
      'worst maximum adverse excursion',
      (candidate) => candidate.lte(0),
    ),
  }
}

function mapPattern(
  value: unknown,
  decisionAt: string,
): HostedPatternStatistic {
  const input = row(value, 'pattern row')
  const proposedAt = timestamp(input.proposed_at, 'pattern proposal timestamp')
  const updatedAt = timestamp(input.updated_at, 'pattern update timestamp')
  const createdAt = timestamp(input.created_at, 'pattern creation timestamp')
  atOrBefore(proposedAt, decisionAt, 'pattern proposal timestamp')
  atOrBefore(updatedAt, decisionAt, 'pattern update timestamp')
  atOrBefore(createdAt, decisionAt, 'pattern creation timestamp')
  const matches = policyMatches(input.gate_config)
  const independentObservations = count(
    input.independent_observations_text,
    'independent observation count',
  )
  const hitRate = nullableExactDecimal(
    input.hit_rate_text,
    'pattern hit rate',
    (candidate) => candidate.gte(0) && candidate.lte(1),
  )
  const meanBenchmarkRelativeReturn = nullableExactDecimal(
    input.mean_benchmark_relative_return_text,
    'pattern mean benchmark-relative return',
  )
  const worstMaximumAdverseExcursion = nullableExactDecimal(
    input.worst_maximum_adverse_excursion_text,
    'pattern worst maximum adverse excursion',
    (candidate) => candidate.lte(0),
  )
  const holdoutPassed = boolean(input.holdout_passed, 'holdout result')
  const returnedMatches = boolean(input.policy_matches, 'policy match result')
  const eligible = boolean(input.eligible, 'eligibility result')
  const reasons = gateReasons(input.reasons, 'pattern gate reasons')
  const expectedReasons = expectedGateReasons({
    policyMatches: matches,
    independentObservations,
    hitRate,
    meanBenchmarkRelativeReturn,
    worstMaximumAdverseExcursion,
    holdoutPassed,
  })
  if (
    returnedMatches !== matches ||
    eligible !== (expectedReasons.length === 0) ||
    !sameStrings(reasons, expectedReasons)
  ) {
    throw new Error('Hosted learning snapshot has an inconsistent pattern gate')
  }
  const policyVersion = text(input.policy_version, 'pattern policy version')
  if (policyVersion !== HOSTED_PATTERN_PROMOTION_POLICY_V1.version) {
    throw new Error('Hosted learning snapshot has an invalid policy version')
  }
  return {
    id: uuid(input.id, 'pattern id'),
    experimentId: uuid(input.experiment_id, 'pattern experiment id'),
    name: text(input.name, 'pattern name'),
    hypothesis: text(input.hypothesis, 'pattern hypothesis'),
    lifecycleStatus: enumValue<HostedPatternLifecycleStatus>(
      input.lifecycle_status,
      patternStatuses,
      'pattern lifecycle status',
    ),
    proposedAt,
    updatedAt,
    createdAt,
    policyVersion,
    independentObservations,
    hitRate,
    meanBenchmarkRelativeReturn,
    worstMaximumAdverseExcursion,
    holdoutPassed,
    policyMatches: matches,
    eligible,
    reasons,
  }
}

function mapAssignment(
  value: unknown,
  decisionAt: string,
): HostedStrategyAssignment {
  const input = row(value, 'strategy assignment row')
  const validFrom = timestamp(input.valid_from, 'assignment start timestamp')
  const validTo = nullableTimestamp(input.valid_to, 'assignment end timestamp')
  const createdAt = timestamp(input.created_at, 'assignment creation timestamp')
  atOrBefore(validFrom, decisionAt, 'assignment start timestamp')
  atOrBefore(createdAt, decisionAt, 'assignment creation timestamp')
  if (validTo && Date.parse(validTo) <= Date.parse(decisionAt)) {
    throw new Error('Hosted learning snapshot has an inactive assignment')
  }
  return {
    id: uuid(input.id, 'assignment id'),
    experimentId: uuid(input.experiment_id, 'assignment experiment id'),
    strategyVersionId: uuid(
      input.strategy_version_id,
      'assignment strategy version id',
    ),
    strategyName: text(input.strategy_name, 'strategy name'),
    strategyVersion: integer(input.strategy_version, 'strategy version', 1),
    strategyContentHash: contentHash(
      input.strategy_content_hash,
      'strategy content hash',
    ),
    assignmentType: enumValue<HostedStrategyAssignmentType>(
      input.assignment_type,
      assignmentTypes,
      'assignment type',
    ),
    allocationFraction: exactDecimal(
      input.allocation_fraction_text,
      'allocation fraction',
      (candidate) => candidate.gte(0) && candidate.lte(1),
    ),
    validFrom,
    validTo,
    promotionEvidence: row(input.promotion_evidence, 'promotion evidence'),
    createdAt,
  }
}

export function mapHostedLearningSnapshotResult(
  result: unknown,
  expectedOwnerId: string,
  requestedDecisionAt: string,
): HostedLearningSnapshot {
  const ownerId = uuid(expectedOwnerId, 'expected owner id')
  const requestedAt = timestamp(requestedDecisionAt, 'requested decisionAt')
  const resultRows = rows(result, 'result rows')
  if (resultRows.length !== 1) {
    throw new Error(
      'Hosted learning snapshot must contain exactly one result row',
    )
  }
  const input = row(resultRows[0], 'result row')
  assertOwner(input.owner_id, ownerId)
  const decisionAt = timestamp(input.decision_at, 'decisionAt')
  sameInstant(decisionAt, requestedAt, 'decisionAt')

  const calibration = rows(input.calibration_rows, 'calibration rows').map(
    mapCalibration,
  )
  const categories = rows(input.category_rows, 'category rows').map(mapCategory)
  const evidenceKinds = rows(
    input.evidence_kind_rows,
    'evidence kind rows',
  ).map(mapEvidenceKind)
  const horizons = rows(input.horizon_rows, 'horizon rows').map(mapHorizon)
  const patterns = rows(input.pattern_rows, 'pattern rows').map((value) =>
    mapPattern(value, decisionAt),
  )
  const assignments = rows(input.assignment_rows, 'assignment rows').map(
    (value) => mapAssignment(value, decisionAt),
  )

  if (patterns.length > MAX_PATTERNS || assignments.length > MAX_ASSIGNMENTS) {
    throw new Error('Hosted learning snapshot exceeded a result bound')
  }
  assertUnique(
    calibration,
    (value) => String(value.bandIndex),
    'calibration band',
  )
  assertUnique(categories, (value) => value.decisionType, 'decision category')
  assertUnique(evidenceKinds, (value) => value.evidenceKind, 'evidence kind')
  assertUnique(horizons, (value) => value.horizon, 'outcome horizon')
  assertUnique(patterns, (value) => value.id, 'pattern id')
  assertUnique(assignments, (value) => value.id, 'assignment id')
  assertUnique(
    assignments,
    (value) => `${value.experimentId}:${value.assignmentType}`,
    'active assignment slot',
  )

  const allocations = new Map<string, FinancialDecimal>()
  for (const assignment of assignments) {
    const current = allocations.get(assignment.experimentId) ?? decimal('0')
    const next = current.plus(assignment.allocationFraction)
    if (next.gt(1)) {
      throw new Error('Hosted learning snapshot has excessive allocation')
    }
    allocations.set(assignment.experimentId, next)
  }

  return {
    source: 'supabase',
    decisionAt,
    calibration,
    categories,
    evidenceKinds,
    horizons,
    patterns,
    assignments,
  }
}
