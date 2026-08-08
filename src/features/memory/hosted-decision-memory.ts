import {
  decimal,
  decimalValue,
  type FinancialDecimal,
} from '@/domain/financial/decimal'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CONTENT_HASH_PATTERN = /^[0-9a-f]{64}$/
const MAX_CONTEXTS = 200
const MAX_EVIDENCE_PER_DECISION = 100

const agentRoles = new Set(['luna', 'terra', 'sol', 'code_review'])
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
const proposalStatuses = new Set([
  'proposed',
  'accepted',
  'rejected',
  'shadow',
  'abstained',
])
const evidenceKinds = new Set([
  'quote',
  'bar',
  'event',
  'knowledge',
  'prior_decision',
])
const outcomeHorizons = new Set(['15m', '1h', 'eod', '1d', '5d'])

type UnknownRow = Record<string, unknown>

export type HostedDecisionType =
  | 'buy'
  | 'sell'
  | 'sell_short'
  | 'buy_to_cover'
  | 'reduce'
  | 'close'
  | 'hold'
  | 'abstain'

export type HostedProposalStatus =
  'proposed' | 'accepted' | 'rejected' | 'shadow' | 'abstained'

export type HostedEvidenceKind =
  'quote' | 'bar' | 'event' | 'knowledge' | 'prior_decision'

export type HostedOutcomeHorizon = '15m' | '1h' | 'eod' | '1d' | '5d'

export interface HostedDecisionContext {
  id: string
  agentRunId: string
  experimentId: string
  experimentVersionId: string
  experimentVersion: number
  experimentVersionContentHash: string
  strategyVersionId: string | null
  decisionAt: string
  portfolioSnapshotId: string | null
  portfolioAsOf: string | null
  netLiquidationValue: string | null
  drawdownFraction: string | null
  agentRole: 'luna' | 'terra' | 'sol' | 'code_review'
  runType: string
  model: string
  promptVersionId: string | null
  routingReason: string
  contextManifest: UnknownRow
  contentHash: string
  createdAt: string
}

export interface HostedAgentDecision {
  id: string
  contextSnapshotId: string
  agentRunId: string
  experimentId: string
  decisionType: HostedDecisionType
  instrumentId: string | null
  structuredOutput: UnknownRow
  conciseRationale: string
  confidence: string | null
  proposalStatus: HostedProposalStatus
  rejectionReasonCode: string | null
  decidedAt: string
  createdAt: string
}

export interface HostedDecisionEvidence {
  id: string
  decisionId: string
  evidenceKind: HostedEvidenceKind
  referenceId: string
  availableAt: string
  citationLabel: string
  createdAt: string
}

export interface HostedTradeOutcome {
  id: string
  decisionId: string
  horizon: HostedOutcomeHorizon
  evaluatedAt: string
  forwardReturn: string
  benchmarkRelativeReturn: string
  maximumFavorableExcursion: string
  maximumAdverseExcursion: string
  thesisValid: boolean | null
  executionOutcome: UnknownRow
  createdAt: string
}

export interface HostedDecisionMemory {
  source: 'supabase'
  decisionAt: string
  contexts: HostedDecisionContext[]
  decisions: HostedAgentDecision[]
  evidence: HostedDecisionEvidence[]
  outcomes: HostedTradeOutcome[]
}

function row(value: unknown, label: string): UnknownRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Hosted decision memory has an invalid ${label}`)
  }
  return value as UnknownRow
}

function rows(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Hosted decision memory has invalid ${label}`)
  }
  return value
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Hosted decision memory has an invalid ${label}`)
  }
  return value
}

function nullableText(value: unknown, label: string): string | null {
  return value === null ? null : text(value, label)
}

function uuid(value: unknown, label: string): string {
  const result = text(value, label)
  if (!UUID_PATTERN.test(result)) {
    throw new Error(`Hosted decision memory has an invalid ${label}`)
  }
  return result
}

function nullableUuid(value: unknown, label: string): string | null {
  return value === null ? null : uuid(value, label)
}

function timestamp(value: unknown, label: string): string {
  const result = text(value, label)
  if (!Number.isFinite(Date.parse(result))) {
    throw new Error(`Hosted decision memory has an invalid ${label}`)
  }
  return result
}

function nullableTimestamp(value: unknown, label: string): string | null {
  return value === null ? null : timestamp(value, label)
}

function integer(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new Error(`Hosted decision memory has an invalid ${label}`)
  }
  return value as number
}

function contentHash(value: unknown, label: string): string {
  const result = text(value, label)
  if (!CONTENT_HASH_PATTERN.test(result)) {
    throw new Error(`Hosted decision memory has an invalid ${label}`)
  }
  return result
}

function exactDecimal(
  value: unknown,
  label: string,
  validate?: (value: FinancialDecimal) => boolean,
): string {
  if (typeof value !== 'string') {
    throw new Error(`Hosted decision memory has an invalid ${label}`)
  }
  try {
    const parsed = decimal(value)
    if (validate && !validate(parsed)) throw new Error('range')
    return decimalValue(parsed)
  } catch {
    throw new Error(`Hosted decision memory has an invalid ${label}`)
  }
}

function nullableExactDecimal(
  value: unknown,
  label: string,
  validate?: (value: FinancialDecimal) => boolean,
): string | null {
  return value === null ? null : exactDecimal(value, label, validate)
}

function nullableBoolean(value: unknown, label: string): boolean | null {
  if (value === null) return null
  if (typeof value !== 'boolean') {
    throw new Error(`Hosted decision memory has an invalid ${label}`)
  }
  return value
}

function enumValue<T extends string>(
  value: unknown,
  allowed: ReadonlySet<string>,
  label: string,
): T {
  const result = text(value, label)
  if (!allowed.has(result)) {
    throw new Error(`Hosted decision memory has an invalid ${label}`)
  }
  return result as T
}

function assertAtOrBefore(
  value: string,
  boundary: string,
  label: string,
): void {
  if (Date.parse(value) > Date.parse(boundary)) {
    throw new Error(`Hosted decision memory has a future ${label}`)
  }
}

function assertSameInstant(left: string, right: string, label: string): void {
  if (Date.parse(left) !== Date.parse(right)) {
    throw new Error(`Hosted decision memory has an inconsistent ${label}`)
  }
}

function assertOwner(value: unknown, ownerId: string, label: string): void {
  if (uuid(value, label) !== ownerId) {
    throw new Error('Hosted decision memory crossed the owner boundary')
  }
}

function uniqueById<T extends { id: string }>(
  values: T[],
  label: string,
): Map<string, T> {
  const result = new Map<string, T>()
  for (const value of values) {
    if (result.has(value.id)) {
      throw new Error(`Hosted decision memory has duplicate ${label} ids`)
    }
    result.set(value.id, value)
  }
  return result
}

function mapContext(
  value: unknown,
  ownerId: string,
  snapshotAt: string,
): HostedDecisionContext {
  const input = row(value, 'context row')
  assertOwner(input.owner_id, ownerId, 'context owner id')
  const decisionAt = timestamp(input.decision_at, 'context decision timestamp')
  const createdAt = timestamp(input.created_at, 'context creation timestamp')
  assertAtOrBefore(decisionAt, snapshotAt, 'context decision timestamp')
  assertAtOrBefore(createdAt, snapshotAt, 'context creation timestamp')
  const portfolioAsOf = nullableTimestamp(
    input.portfolio_as_of,
    'portfolio availability timestamp',
  )
  if (portfolioAsOf) {
    assertAtOrBefore(
      portfolioAsOf,
      decisionAt,
      'portfolio availability timestamp',
    )
  }
  const drawdownFraction = nullableExactDecimal(
    input.drawdown_fraction_text,
    'drawdown fraction',
    (candidate) => candidate.gte(0) && candidate.lte(1),
  )
  return {
    id: uuid(input.id, 'context id'),
    agentRunId: uuid(input.agent_run_id, 'context agent run id'),
    experimentId: uuid(input.experiment_id, 'context experiment id'),
    experimentVersionId: uuid(
      input.experiment_version_id,
      'context experiment version id',
    ),
    experimentVersion: integer(
      input.experiment_version,
      'experiment version',
      1,
    ),
    experimentVersionContentHash: contentHash(
      input.experiment_version_content_hash,
      'experiment version content hash',
    ),
    strategyVersionId: nullableUuid(
      input.strategy_version_id,
      'strategy version id',
    ),
    decisionAt,
    portfolioSnapshotId: nullableUuid(
      input.portfolio_snapshot_id,
      'portfolio snapshot id',
    ),
    portfolioAsOf,
    netLiquidationValue: nullableExactDecimal(
      input.net_liquidation_value_text,
      'net liquidation value',
    ),
    drawdownFraction,
    agentRole: enumValue(
      input.agent_role,
      agentRoles,
      'agent role',
    ) as HostedDecisionContext['agentRole'],
    runType: text(input.run_type, 'run type'),
    model: text(input.model, 'model'),
    promptVersionId: nullableUuid(input.prompt_version_id, 'prompt version id'),
    routingReason: text(input.routing_reason, 'routing reason'),
    contextManifest: row(input.context_manifest, 'context manifest'),
    contentHash: contentHash(input.content_hash, 'context content hash'),
    createdAt,
  }
}

function mapDecision(
  value: unknown,
  ownerId: string,
  snapshotAt: string,
): HostedAgentDecision {
  const input = row(value, 'decision row')
  assertOwner(input.owner_id, ownerId, 'decision owner id')
  const decidedAt = timestamp(input.decided_at, 'decision timestamp')
  const createdAt = timestamp(input.created_at, 'decision creation timestamp')
  assertAtOrBefore(decidedAt, snapshotAt, 'decision timestamp')
  assertAtOrBefore(createdAt, snapshotAt, 'decision creation timestamp')
  const decisionType = enumValue<HostedDecisionType>(
    input.decision_type,
    decisionTypes,
    'decision type',
  )
  const instrumentId = nullableUuid(input.instrument_id, 'instrument id')
  if (!['hold', 'abstain'].includes(decisionType) && !instrumentId) {
    throw new Error(
      'Hosted decision memory has an actionable decision without an instrument',
    )
  }
  return {
    id: uuid(input.id, 'decision id'),
    contextSnapshotId: uuid(input.context_snapshot_id, 'context snapshot id'),
    agentRunId: uuid(input.agent_run_id, 'decision agent run id'),
    experimentId: uuid(input.experiment_id, 'decision experiment id'),
    decisionType,
    instrumentId,
    structuredOutput: row(input.structured_output, 'structured output'),
    conciseRationale: text(input.concise_rationale, 'concise rationale'),
    confidence: nullableExactDecimal(
      input.confidence_text,
      'confidence',
      (candidate) => candidate.gte(0) && candidate.lte(1),
    ),
    proposalStatus: enumValue<HostedProposalStatus>(
      input.proposal_status,
      proposalStatuses,
      'proposal status',
    ),
    rejectionReasonCode: nullableText(
      input.rejection_reason_code,
      'rejection reason code',
    ),
    decidedAt,
    createdAt,
  }
}

function mapEvidence(
  value: unknown,
  ownerId: string,
  snapshotAt: string,
): HostedDecisionEvidence {
  const input = row(value, 'evidence row')
  assertOwner(input.owner_id, ownerId, 'evidence owner id')
  const evidenceKind = enumValue<HostedEvidenceKind>(
    input.evidence_kind,
    evidenceKinds,
    'evidence kind',
  )
  const references = {
    quote: nullableUuid(input.market_quote_id, 'market quote id'),
    bar: nullableUuid(input.market_bar_id, 'market bar id'),
    event: nullableUuid(input.event_revision_id, 'event revision id'),
    knowledge: nullableUuid(input.knowledge_chunk_id, 'knowledge chunk id'),
    prior_decision: nullableUuid(input.prior_decision_id, 'prior decision id'),
  }
  const populated = Object.values(references).filter(
    (reference): reference is string => reference !== null,
  )
  const referenceId = references[evidenceKind]
  if (populated.length !== 1 || !referenceId) {
    throw new Error(
      'Hosted decision memory has inconsistent evidence references',
    )
  }
  const availableAt = timestamp(
    input.evidence_available_at,
    'evidence availability timestamp',
  )
  const createdAt = timestamp(input.created_at, 'evidence creation timestamp')
  assertAtOrBefore(availableAt, snapshotAt, 'evidence availability timestamp')
  assertAtOrBefore(createdAt, snapshotAt, 'evidence creation timestamp')
  return {
    id: uuid(input.id, 'evidence id'),
    decisionId: uuid(input.decision_id, 'evidence decision id'),
    evidenceKind,
    referenceId,
    availableAt,
    citationLabel: text(input.citation_label, 'citation label'),
    createdAt,
  }
}

function mapOutcome(
  value: unknown,
  ownerId: string,
  snapshotAt: string,
): HostedTradeOutcome {
  const input = row(value, 'outcome row')
  assertOwner(input.owner_id, ownerId, 'outcome owner id')
  const evaluatedAt = timestamp(input.evaluated_at, 'outcome timestamp')
  const createdAt = timestamp(input.created_at, 'outcome creation timestamp')
  assertAtOrBefore(evaluatedAt, snapshotAt, 'outcome timestamp')
  assertAtOrBefore(createdAt, snapshotAt, 'outcome creation timestamp')
  return {
    id: uuid(input.id, 'outcome id'),
    decisionId: uuid(input.decision_id, 'outcome decision id'),
    horizon: enumValue<HostedOutcomeHorizon>(
      input.horizon,
      outcomeHorizons,
      'outcome horizon',
    ),
    evaluatedAt,
    forwardReturn: exactDecimal(input.forward_return_text, 'forward return'),
    benchmarkRelativeReturn: exactDecimal(
      input.benchmark_relative_return_text,
      'benchmark-relative return',
    ),
    maximumFavorableExcursion: exactDecimal(
      input.maximum_favorable_excursion_text,
      'maximum favorable excursion',
      (candidate) => candidate.gte(0),
    ),
    maximumAdverseExcursion: exactDecimal(
      input.maximum_adverse_excursion_text,
      'maximum adverse excursion',
      (candidate) => candidate.lte(0),
    ),
    thesisValid: nullableBoolean(input.thesis_valid, 'thesis-valid flag'),
    executionOutcome: row(input.execution_outcome, 'execution outcome'),
    createdAt,
  }
}

export function mapHostedDecisionMemoryResult(
  result: unknown,
  expectedOwnerId: string,
  requestedDecisionAt: string,
): HostedDecisionMemory {
  const ownerId = uuid(expectedOwnerId, 'expected owner id')
  const requestedAt = timestamp(requestedDecisionAt, 'requested decisionAt')
  const resultRows = rows(result, 'result rows')
  if (resultRows.length !== 1) {
    throw new Error(
      'Hosted decision memory must contain exactly one result row',
    )
  }
  const input = row(resultRows[0], 'result row')
  assertOwner(input.owner_id, ownerId, 'result owner id')
  const decisionAt = timestamp(input.decision_at, 'decisionAt')
  assertSameInstant(decisionAt, requestedAt, 'decisionAt')

  const contexts = rows(input.context_rows, 'context rows').map((value) =>
    mapContext(value, ownerId, decisionAt),
  )
  if (contexts.length > MAX_CONTEXTS) {
    throw new Error('Hosted decision memory exceeded the context bound')
  }
  const contextById = uniqueById(contexts, 'context')

  const decisions = rows(input.decision_rows, 'decision rows').map((value) =>
    mapDecision(value, ownerId, decisionAt),
  )
  const decisionById = uniqueById(decisions, 'decision')
  for (const decision of decisions) {
    const context = contextById.get(decision.contextSnapshotId)
    if (
      !context ||
      context.agentRunId !== decision.agentRunId ||
      context.experimentId !== decision.experimentId
    ) {
      throw new Error('Hosted decision memory has inconsistent decision scope')
    }
    assertSameInstant(decision.decidedAt, context.decisionAt, 'decision time')
  }

  const evidence = rows(input.evidence_rows, 'evidence rows').map((value) =>
    mapEvidence(value, ownerId, decisionAt),
  )
  uniqueById(evidence, 'evidence')
  const evidenceCounts = new Map<string, number>()
  for (const item of evidence) {
    const decision = decisionById.get(item.decisionId)
    if (!decision) {
      throw new Error('Hosted decision memory has orphaned evidence')
    }
    assertAtOrBefore(
      item.availableAt,
      decision.decidedAt,
      'evidence decision availability timestamp',
    )
    const count = (evidenceCounts.get(item.decisionId) ?? 0) + 1
    if (count > MAX_EVIDENCE_PER_DECISION) {
      throw new Error('Hosted decision memory exceeded the evidence bound')
    }
    evidenceCounts.set(item.decisionId, count)
  }

  const outcomes = rows(input.outcome_rows, 'outcome rows').map((value) =>
    mapOutcome(value, ownerId, decisionAt),
  )
  uniqueById(outcomes, 'outcome')
  const outcomeKeys = new Set<string>()
  for (const outcome of outcomes) {
    const decision = decisionById.get(outcome.decisionId)
    if (
      !decision ||
      Date.parse(outcome.evaluatedAt) <= Date.parse(decision.decidedAt)
    ) {
      throw new Error('Hosted decision memory has an invalid outcome boundary')
    }
    const key = `${outcome.decisionId}:${outcome.horizon}`
    if (outcomeKeys.has(key)) {
      throw new Error('Hosted decision memory has duplicate decision horizons')
    }
    outcomeKeys.add(key)
  }

  return {
    source: 'supabase',
    decisionAt,
    contexts,
    decisions,
    evidence,
    outcomes,
  }
}
