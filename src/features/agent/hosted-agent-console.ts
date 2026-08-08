import {
  tradeProposalSchema,
  validateProposalSemantics,
} from '@/domain/agent/schemas'
import type { TradeProposal } from '@/domain/agent/schemas'
import { decimal, decimalValue } from '@/domain/financial/decimal'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COUNT_PATTERN = /^(0|[1-9][0-9]*)$/
const MAX_ROWS = 100

const roles = new Set(['luna', 'terra', 'sol', 'code_review'])
const runStatuses = new Set([
  'pending',
  'running',
  'completed',
  'failed',
  'skipped',
  'unknown',
])
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
const toolStatuses = new Set(['completed', 'failed', 'denied'])

type UnknownRow = Record<string, unknown>

export type HostedAgentRole = 'luna' | 'terra' | 'sol' | 'code_review'
export type HostedAgentRunStatus =
  'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'unknown'

export interface HostedAgentConsoleRun {
  id: string
  experimentId: string
  role: HostedAgentRole
  runType: string
  model: string
  promptVersionId: string | null
  status: HostedAgentRunStatus
  routingReason: string
  decisionAt: string
  startedAt: string | null
  finishedAt: string | null
  inputTokens: string | null
  cachedInputTokens: string | null
  outputTokens: string | null
  reasoningTokens: string | null
  webSearchCalls: string | null
  actualCostUsd: string | null
  latencyMs: string | null
  finishState: string | null
}

export interface HostedAgentConsoleDecision {
  id: string
  agentRunId: string
  experimentId: string
  decisionType: string
  instrumentId: string | null
  structuredOutput: UnknownRow
  proposal: TradeProposal | null
  conciseRationale: string
  confidence: string | null
  proposalStatus: string
  rejectionReasonCode: string | null
  decidedAt: string
}

export interface HostedAgentConsoleEvidence {
  id: string
  decisionId: string
  evidenceKind: string
  evidenceId: string
  evidenceAvailableAt: string
  citationLabel: string
}

export interface HostedAgentConsoleToolCall {
  id: string
  agentRunId: string
  sequenceNo: string
  toolName: string
  requestSummary: UnknownRow
  responseSummary: UnknownRow
  startedAt: string
  finishedAt: string | null
  status: string
}

export interface HostedAgentConsole {
  source: 'supabase'
  decisionAt: string
  runs: HostedAgentConsoleRun[]
  decisions: HostedAgentConsoleDecision[]
  evidence: HostedAgentConsoleEvidence[]
  toolCalls: HostedAgentConsoleToolCall[]
}

function row(value: unknown, label: string): UnknownRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Hosted agent console has an invalid ${label}`)
  }
  return value as UnknownRow
}

function rows(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value) || value.length > MAX_ROWS) {
    throw new Error(`Hosted agent console has invalid ${label}`)
  }
  return value
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Hosted agent console has an invalid ${label}`)
  }
  return value
}

function nullableText(value: unknown, label: string): string | null {
  return value === null ? null : text(value, label)
}

function uuid(value: unknown, label: string): string {
  const result = text(value, label)
  if (!UUID_PATTERN.test(result)) {
    throw new Error(`Hosted agent console has an invalid ${label}`)
  }
  return result
}

function nullableUuid(value: unknown, label: string): string | null {
  return value === null ? null : uuid(value, label)
}

function timestamp(value: unknown, label: string): string {
  const result = text(value, label)
  if (!Number.isFinite(Date.parse(result))) {
    throw new Error(`Hosted agent console has an invalid ${label}`)
  }
  return result
}

function nullableTimestamp(value: unknown, label: string): string | null {
  return value === null ? null : timestamp(value, label)
}

function exactDecimal(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Hosted agent console has an invalid ${label}`)
  }
  try {
    return decimalValue(decimal(value))
  } catch {
    throw new Error(`Hosted agent console has an invalid ${label}`)
  }
}

function nullableExactDecimal(value: unknown, label: string): string | null {
  return value === null ? null : exactDecimal(value, label)
}

function countText(value: unknown, label: string): string {
  const result = text(value, label)
  if (!COUNT_PATTERN.test(result)) {
    throw new Error(`Hosted agent console has an invalid ${label}`)
  }
  return result
}

function nullableCountText(value: unknown, label: string): string | null {
  return value === null ? null : countText(value, label)
}

function enumValue<T extends string>(
  value: unknown,
  allowed: ReadonlySet<string>,
  label: string,
): T {
  const result = text(value, label)
  if (!allowed.has(result)) {
    throw new Error(`Hosted agent console has an invalid ${label}`)
  }
  return result as T
}

function atOrBefore(value: string, boundary: string, label: string): void {
  if (Date.parse(value) > Date.parse(boundary)) {
    throw new Error(`Hosted agent console has a future ${label}`)
  }
}

function uniqueById<T extends { id: string }>(
  values: T[],
  label: string,
): Map<string, T> {
  const result = new Map<string, T>()
  for (const value of values) {
    if (result.has(value.id)) {
      throw new Error(`Hosted agent console has duplicate ${label} ids`)
    }
    result.set(value.id, value)
  }
  return result
}

function mapRun(value: unknown, snapshotAt: string): HostedAgentConsoleRun {
  const input = row(value, 'run row')
  const decisionAt = timestamp(input.decisionAt, 'run decision timestamp')
  const startedAt = nullableTimestamp(input.startedAt, 'run start timestamp')
  const finishedAt = nullableTimestamp(input.finishedAt, 'run finish timestamp')
  atOrBefore(decisionAt, snapshotAt, 'run decision timestamp')
  if (startedAt) atOrBefore(startedAt, snapshotAt, 'run start timestamp')
  if (finishedAt) atOrBefore(finishedAt, snapshotAt, 'run finish timestamp')

  return {
    id: uuid(input.id, 'run id'),
    experimentId: uuid(input.experimentId, 'run experiment id'),
    role: enumValue(input.role, roles, 'run role'),
    runType: text(input.runType, 'run type'),
    model: text(input.model, 'run model'),
    promptVersionId: nullableUuid(input.promptVersionId, 'prompt version id'),
    status: enumValue(input.status, runStatuses, 'run status'),
    routingReason: text(input.routingReason, 'routing reason'),
    decisionAt,
    startedAt,
    finishedAt,
    inputTokens: nullableCountText(input.inputTokens, 'input tokens'),
    cachedInputTokens: nullableCountText(
      input.cachedInputTokens,
      'cached input tokens',
    ),
    outputTokens: nullableCountText(input.outputTokens, 'output tokens'),
    reasoningTokens: nullableCountText(
      input.reasoningTokens,
      'reasoning tokens',
    ),
    webSearchCalls: nullableCountText(input.webSearchCalls, 'web search calls'),
    actualCostUsd: nullableExactDecimal(input.actualCostUsd, 'actual cost'),
    latencyMs: nullableCountText(input.latencyMs, 'latency'),
    finishState: nullableText(input.finishState, 'finish state'),
  }
}

function mapDecision(
  value: unknown,
  snapshotAt: string,
  runById: ReadonlyMap<string, HostedAgentConsoleRun>,
): HostedAgentConsoleDecision {
  const input = row(value, 'decision row')
  const id = uuid(input.id, 'decision id')
  const agentRunId = uuid(input.agentRunId, 'decision run id')
  const run = runById.get(agentRunId)
  if (!run) throw new Error('Hosted agent console has an orphaned decision')
  const experimentId = uuid(input.experimentId, 'decision experiment id')
  if (experimentId !== run.experimentId) {
    throw new Error('Hosted agent console has inconsistent decision scope')
  }
  const decidedAt = timestamp(input.decidedAt, 'decision timestamp')
  atOrBefore(decidedAt, snapshotAt, 'decision timestamp')
  if (Date.parse(decidedAt) !== Date.parse(run.decisionAt)) {
    throw new Error('Hosted agent console has an inconsistent decision time')
  }
  const structuredOutput = row(input.structuredOutput, 'structured output')
  let proposal: TradeProposal | null = null
  const parsed = tradeProposalSchema.strict().safeParse(structuredOutput)
  if (parsed.success) proposal = validateProposalSemantics(parsed.data)
  else if (run.runType === 'hosted_shadow_v1') {
    throw new Error('Hosted agent console has an invalid structured proposal')
  }

  return {
    id,
    agentRunId,
    experimentId,
    decisionType: enumValue(input.decisionType, decisionTypes, 'decision type'),
    instrumentId: nullableUuid(input.instrumentId, 'decision instrument id'),
    structuredOutput,
    proposal,
    conciseRationale: text(input.conciseRationale, 'concise rationale'),
    confidence: nullableExactDecimal(input.confidence, 'decision confidence'),
    proposalStatus: enumValue(
      input.proposalStatus,
      proposalStatuses,
      'proposal status',
    ),
    rejectionReasonCode: nullableText(
      input.rejectionReasonCode,
      'rejection reason code',
    ),
    decidedAt,
  }
}

function mapEvidence(
  value: unknown,
  snapshotAt: string,
  decisionById: ReadonlyMap<string, HostedAgentConsoleDecision>,
): HostedAgentConsoleEvidence {
  const input = row(value, 'evidence row')
  const decisionId = uuid(input.decisionId, 'evidence decision id')
  const decision = decisionById.get(decisionId)
  if (!decision) throw new Error('Hosted agent console has orphaned evidence')
  const evidenceAvailableAt = timestamp(
    input.evidenceAvailableAt,
    'evidence availability timestamp',
  )
  atOrBefore(evidenceAvailableAt, snapshotAt, 'evidence timestamp')
  atOrBefore(evidenceAvailableAt, decision.decidedAt, 'decision evidence')
  return {
    id: uuid(input.id, 'evidence id'),
    decisionId,
    evidenceKind: enumValue(input.evidenceKind, evidenceKinds, 'evidence kind'),
    evidenceId: uuid(input.evidenceId, 'evidence reference id'),
    evidenceAvailableAt,
    citationLabel: text(input.citationLabel, 'citation label'),
  }
}

function mapToolCall(
  value: unknown,
  snapshotAt: string,
  runById: ReadonlyMap<string, HostedAgentConsoleRun>,
): HostedAgentConsoleToolCall {
  const input = row(value, 'tool-call row')
  const agentRunId = uuid(input.agentRunId, 'tool-call run id')
  if (!runById.has(agentRunId)) {
    throw new Error('Hosted agent console has an orphaned tool call')
  }
  const startedAt = timestamp(input.startedAt, 'tool-call start timestamp')
  const finishedAt = nullableTimestamp(
    input.finishedAt,
    'tool-call finish timestamp',
  )
  atOrBefore(startedAt, snapshotAt, 'tool-call start timestamp')
  if (finishedAt)
    atOrBefore(finishedAt, snapshotAt, 'tool-call finish timestamp')
  return {
    id: uuid(input.id, 'tool-call id'),
    agentRunId,
    sequenceNo: countText(input.sequenceNo, 'tool-call sequence'),
    toolName: text(input.toolName, 'tool name'),
    requestSummary: row(input.requestSummary, 'tool request summary'),
    responseSummary: row(input.responseSummary, 'tool response summary'),
    startedAt,
    finishedAt,
    status: enumValue(input.status, toolStatuses, 'tool-call status'),
  }
}

export function mapHostedAgentConsoleResult(
  result: unknown,
  expectedOwnerId: string,
  requestedDecisionAt: string,
): HostedAgentConsole {
  const ownerId = uuid(expectedOwnerId, 'expected owner id')
  const snapshotAt = timestamp(requestedDecisionAt, 'requested decisionAt')
  const resultRows = rows(result, 'result rows')
  if (resultRows.length !== 1) {
    throw new Error('Hosted agent console must contain exactly one result row')
  }
  const input = row(resultRows[0], 'result row')
  if (uuid(input.owner_id, 'result owner id') !== ownerId) {
    throw new Error('Hosted agent console crossed the owner boundary')
  }
  const decisionAt = timestamp(input.decision_at, 'result decisionAt')
  if (Date.parse(decisionAt) !== Date.parse(snapshotAt)) {
    throw new Error('Hosted agent console returned a different decisionAt')
  }

  const runs = rows(input.run_rows, 'run rows').map((value) =>
    mapRun(value, decisionAt),
  )
  const runById = uniqueById(runs, 'run')
  const decisions = rows(input.decision_rows, 'decision rows').map((value) =>
    mapDecision(value, decisionAt, runById),
  )
  const decisionById = uniqueById(decisions, 'decision')
  const evidence = rows(input.evidence_rows, 'evidence rows').map((value) =>
    mapEvidence(value, decisionAt, decisionById),
  )
  uniqueById(evidence, 'evidence')
  const toolCalls = rows(input.tool_call_rows, 'tool-call rows').map((value) =>
    mapToolCall(value, decisionAt, runById),
  )
  uniqueById(toolCalls, 'tool call')

  return {
    source: 'supabase',
    decisionAt,
    runs,
    decisions,
    evidence,
    toolCalls,
  }
}
