import 'server-only'

import {
  LUNA_DECISION_SCHEMA_ID,
  lunaDecisionSchema,
  tradeProposalSchema,
  TRADE_PROPOSAL_SCHEMA_ID,
  validateProposalSemantics,
} from '@/domain/agent/schemas'
import { decimal, decimalValue } from '@/domain/financial/decimal'
import { deriveHostedAgentRuntimeReadiness } from '@/features/agent/hosted-agent-runtime-readiness'
import { getServerEnvironment } from '@/lib/env/server'
import { log } from '@/lib/logging/logger'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import {
  beginHostedAgentRun,
  failHostedAgentRun,
  finalizeHostedLunaRun,
  finalizeHostedShadowProposal,
  type BeginHostedAgentRunInput,
  type BeginHostedAgentRunResult,
  type FailHostedAgentRunInput,
  type FinalizeHostedLunaRunInput,
  type FinalizeHostedShadowProposalInput,
} from '@/lib/supabase/agent-runtime-repository'
import type { Json } from '@/lib/supabase/database.types'
import { createOpenAIGateway } from '@/providers/openai/factory'
import type { OpenAIGateway } from '@/providers/openai/types'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REVISION_PATTERN = /^(0|[1-9][0-9]*)$/
const COUNT_PATTERN = /^(0|[1-9][0-9]*)$/
const MAX_CONTEXT_CHARACTERS = 100_000

export type HostedProposalEvidence = {
  kind: 'quote' | 'bar' | 'event' | 'knowledge' | 'prior_decision'
  id: string
  citationLabel: string
}

export type HostedShadowProposalInput = {
  ownerId: string
  operationId: string
  experimentId: string
  expectedControlStateVersion: string
  decisionAt: string
  role: 'terra' | 'sol'
  parentAgentRunId: string | null
  routingReason:
    | 'qualifying_luna_event'
    | 'exceptional_deterministic_trigger'
    | 'multi_source_conflict'
    | 'portfolio_wide_consequence'
    | 'high_materiality_ambiguity'
  contextManifest: Json
  evidence: readonly HostedProposalEvidence[]
}

export type HostedShadowProposalRunResult =
  | {
      status: 'disabled' | 'skipped'
      reason: string
      providerCallState: 'not_started'
      paperOrdersCreated: 0
      paperFillsCreated: 0
      ledgerEntriesCreated: 0
    }
  | {
      status: 'completed'
      agentRunId: string
      decisionId: string
      providerCallState: 'completed'
      paperOrdersCreated: 0
      paperFillsCreated: 0
      ledgerEntriesCreated: 0
      replayed: boolean
    }
  | {
      status: 'failed_unknown_cost'
      agentRunId: string
      reason: string
      providerCallState: 'unknown'
      paperOrdersCreated: 0
      paperFillsCreated: 0
      ledgerEntriesCreated: 0
    }

export type HostedLunaInput = {
  ownerId: string
  operationId: string
  experimentId: string
  expectedControlStateVersion: string
  decisionAt: string
  candidates: readonly { candidateId: string; data: Json }[]
}

export type HostedLunaRunResult =
  | {
      status: 'disabled' | 'skipped'
      reason: string
      providerCallState: 'not_started'
      paperOrdersCreated: 0
      paperFillsCreated: 0
      ledgerEntriesCreated: 0
    }
  | {
      status: 'completed'
      agentRunId: string
      terraEscalationRequested: boolean
      providerCallState: 'completed'
      paperOrdersCreated: 0
      paperFillsCreated: 0
      ledgerEntriesCreated: 0
      replayed: boolean
    }
  | {
      status: 'failed_unknown_cost'
      agentRunId: string
      reason: string
      providerCallState: 'unknown'
      paperOrdersCreated: 0
      paperFillsCreated: 0
      ledgerEntriesCreated: 0
    }

export type HostedAgentRuntimeDependencies = {
  gateway: OpenAIGateway
  begin(input: BeginHostedAgentRunInput): Promise<BeginHostedAgentRunResult>
  finalize(input: FinalizeHostedShadowProposalInput): Promise<{
    agentRunId: string
    decisionId: string
    paperOrdersCreated: 0
    paperFillsCreated: 0
    ledgerEntriesCreated: 0
    replayed: boolean
  }>
  fail(input: FailHostedAgentRunInput): Promise<unknown>
}

export type HostedLunaRuntimeDependencies = {
  gateway: OpenAIGateway
  begin(input: BeginHostedAgentRunInput): Promise<BeginHostedAgentRunResult>
  finalize(input: FinalizeHostedLunaRunInput): Promise<{
    agentRunId: string
    terraEscalationRequested: boolean
    paperOrdersCreated: 0
    paperFillsCreated: 0
    ledgerEntriesCreated: 0
    replayed: boolean
  }>
  fail(input: FailHostedAgentRunInput): Promise<unknown>
}

function assertUuid(value: string, label: string): void {
  if (!UUID_PATTERN.test(value)) throw new TypeError(`${label} must be a UUID`)
}

function validateInput(input: HostedShadowProposalInput): string {
  assertUuid(input.ownerId, 'ownerId')
  assertUuid(input.operationId, 'operationId')
  assertUuid(input.experimentId, 'experimentId')
  if (input.parentAgentRunId) {
    assertUuid(input.parentAgentRunId, 'parentAgentRunId')
  }
  if (!REVISION_PATTERN.test(input.expectedControlStateVersion)) {
    throw new TypeError('expectedControlStateVersion must be canonical')
  }
  if (!Number.isFinite(Date.parse(input.decisionAt))) {
    throw new TypeError('decisionAt must be a timestamp')
  }
  if (
    input.role === 'terra' &&
    !['qualifying_luna_event', 'exceptional_deterministic_trigger'].includes(
      input.routingReason,
    )
  ) {
    throw new TypeError('Terra routing reason is invalid')
  }
  if (
    input.role === 'sol' &&
    ![
      'multi_source_conflict',
      'portfolio_wide_consequence',
      'high_materiality_ambiguity',
    ].includes(input.routingReason)
  ) {
    throw new TypeError('Sol routing reason is invalid')
  }
  if (
    (input.routingReason === 'qualifying_luna_event' || input.role === 'sol') &&
    input.parentAgentRunId === null
  ) {
    throw new TypeError('Escalated agent calls require a parent run')
  }
  if (input.evidence.length < 1 || input.evidence.length > 30) {
    throw new TypeError('Evidence must contain 1 to 30 references')
  }
  const evidenceIds = new Set<string>()
  for (const evidence of input.evidence) {
    assertUuid(evidence.id, 'evidence id')
    if (
      evidenceIds.has(evidence.id) ||
      evidence.citationLabel.trim().length < 1 ||
      evidence.citationLabel.length > 200
    ) {
      throw new TypeError('Evidence references are invalid')
    }
    evidenceIds.add(evidence.id)
  }
  const serializedContext = JSON.stringify({
    contractVersion: 1,
    decisionAt: input.decisionAt,
    context: input.contextManifest,
    evidence: input.evidence,
  })
  if (serializedContext.length > MAX_CONTEXT_CHARACTERS) {
    throw new TypeError('Hosted agent context exceeds its bound')
  }
  return serializedContext
}

function validateLunaInput(input: HostedLunaInput): string {
  assertUuid(input.ownerId, 'ownerId')
  assertUuid(input.operationId, 'operationId')
  assertUuid(input.experimentId, 'experimentId')
  if (!REVISION_PATTERN.test(input.expectedControlStateVersion)) {
    throw new TypeError('expectedControlStateVersion must be canonical')
  }
  if (!Number.isFinite(Date.parse(input.decisionAt))) {
    throw new TypeError('decisionAt must be a timestamp')
  }
  if (input.candidates.length < 1 || input.candidates.length > 10) {
    throw new TypeError('Luna requires 1 to 10 candidates')
  }
  const candidateIds = new Set<string>()
  for (const candidate of input.candidates) {
    if (
      candidate.candidateId.trim().length < 1 ||
      candidate.candidateId.length > 200 ||
      candidateIds.has(candidate.candidateId)
    ) {
      throw new TypeError('Luna candidate ids are invalid')
    }
    candidateIds.add(candidate.candidateId)
  }
  const serialized = JSON.stringify({
    contractVersion: 1,
    decisionAt: input.decisionAt,
    candidates: input.candidates,
  })
  if (serialized.length > MAX_CONTEXT_CHARACTERS) {
    throw new TypeError('Luna context exceeds its bound')
  }
  return serialized
}

function count(value: string, label: string): number {
  if (!COUNT_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a canonical count`)
  }
  const parsed = BigInt(value)
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new TypeError(`${label} exceeds the safe transport range`)
  }
  return Number(parsed)
}

function confidenceFraction(confidencePercent: number): string {
  return decimalValue(decimal(String(confidencePercent)).div('100'))
}

function proposalEvidenceMatches(
  proposalEvidenceIds: readonly string[],
  evidence: readonly HostedProposalEvidence[],
): boolean {
  if (proposalEvidenceIds.length !== evidence.length) return false
  const expected = new Set(evidence.map((item) => item.id))
  return (
    expected.size === evidence.length &&
    new Set(proposalEvidenceIds).size === proposalEvidenceIds.length &&
    proposalEvidenceIds.every((id) => expected.has(id))
  )
}

function asJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json
}

async function markUnknown(
  dependencies: HostedAgentRuntimeDependencies,
  input: HostedShadowProposalInput,
  begin: BeginHostedAgentRunResult,
  reason: string,
): Promise<HostedShadowProposalRunResult> {
  if (!begin.reservationId) {
    throw new Error('Hosted agent runtime lost its reservation evidence')
  }
  try {
    await dependencies.fail({
      ownerId: input.ownerId,
      agentRunId: begin.agentRunId,
      reservationId: begin.reservationId,
      reservationOutcome: 'unknown',
      errorClass: reason.slice(0, 100),
    })
  } catch (error) {
    log('error', 'Hosted agent unknown-cost transition failed', {
      operation: 'hosted_agent_mark_unknown',
      experimentId: input.experimentId,
      agentRunId: begin.agentRunId,
      errorClass: error instanceof Error ? error.name : 'UnknownThrownValue',
    })
  }
  return {
    status: 'failed_unknown_cost',
    agentRunId: begin.agentRunId,
    reason,
    providerCallState: 'unknown',
    paperOrdersCreated: 0,
    paperFillsCreated: 0,
    ledgerEntriesCreated: 0,
  }
}

async function markLunaUnknown(
  dependencies: HostedLunaRuntimeDependencies,
  input: HostedLunaInput,
  begin: BeginHostedAgentRunResult,
  reason: string,
): Promise<HostedLunaRunResult> {
  if (!begin.reservationId) {
    throw new Error('Hosted Luna runtime lost its reservation evidence')
  }
  try {
    await dependencies.fail({
      ownerId: input.ownerId,
      agentRunId: begin.agentRunId,
      reservationId: begin.reservationId,
      reservationOutcome: 'unknown',
      errorClass: reason.slice(0, 100),
    })
  } catch (error) {
    log('error', 'Hosted Luna unknown-cost transition failed', {
      operation: 'hosted_luna_mark_unknown',
      experimentId: input.experimentId,
      agentRunId: begin.agentRunId,
      errorClass: error instanceof Error ? error.name : 'UnknownThrownValue',
    })
  }
  return {
    status: 'failed_unknown_cost',
    agentRunId: begin.agentRunId,
    reason,
    providerCallState: 'unknown',
    paperOrdersCreated: 0,
    paperFillsCreated: 0,
    ledgerEntriesCreated: 0,
  }
}

export async function runHostedLunaWithDependencies(
  input: HostedLunaInput,
  dependencies: HostedLunaRuntimeDependencies,
): Promise<HostedLunaRunResult> {
  const serializedInput = validateLunaInput(input)
  const begin = await dependencies.begin({
    ownerId: input.ownerId,
    operationId: input.operationId,
    experimentId: input.experimentId,
    expectedControlStateVersion: input.expectedControlStateVersion,
    decisionAt: input.decisionAt,
    role: 'luna',
    parentAgentRunId: null,
    routingReason: 'scheduled_candidates',
    candidateCount: input.candidates.length,
    maxInputTokens: 8_000,
    maxOutputTokens: 500,
    maxToolCalls: 0,
  })
  if (!begin.allowed || !begin.reservationId) {
    return {
      status: 'skipped',
      reason: begin.reason,
      providerCallState: 'not_started',
      paperOrdersCreated: 0,
      paperFillsCreated: 0,
      ledgerEntriesCreated: 0,
    }
  }
  if (begin.outputSchema.$id !== LUNA_DECISION_SCHEMA_ID) {
    await dependencies.fail({
      ownerId: input.ownerId,
      agentRunId: begin.agentRunId,
      reservationId: begin.reservationId,
      reservationOutcome: 'released',
      errorClass: 'prompt_schema_contract_mismatch',
    })
    return {
      status: 'skipped',
      reason: 'prompt_schema_contract_mismatch',
      providerCallState: 'not_started',
      paperOrdersCreated: 0,
      paperFillsCreated: 0,
      ledgerEntriesCreated: 0,
    }
  }
  try {
    const generated = await dependencies.gateway.generateStructured({
      model: 'gpt-5.6-luna',
      schemaName: 'luna_relevance',
      schema: lunaDecisionSchema,
      system: begin.systemPrompt,
      input: serializedInput,
      maxOutputTokens: 500,
      reasoningEffort: 'low',
    })
    const expectedIds = new Set(
      input.candidates.map((item) => item.candidateId),
    )
    if (
      generated.output.candidates.length !== input.candidates.length ||
      new Set(generated.output.candidates.map((item) => item.candidateId))
        .size !== input.candidates.length ||
      generated.output.candidates.some(
        (candidate) => !expectedIds.has(candidate.candidateId),
      )
    ) {
      return markLunaUnknown(
        dependencies,
        input,
        begin,
        'provider_candidate_set_mismatch',
      )
    }
    const finalized = await dependencies.finalize({
      ownerId: input.ownerId,
      agentRunId: begin.agentRunId,
      reservationId: begin.reservationId,
      providerResponseId: generated.responseId,
      output: asJson(generated.output),
      inputTokens: count(
        generated.providerInputTokens,
        'provider input tokens',
      ),
      cachedInputTokens: count(
        generated.usage.cachedInputTokens,
        'cached input tokens',
      ),
      cacheWriteTokens: count(
        generated.usage.cacheWriteTokens,
        'cache-write tokens',
      ),
      outputTokens: count(generated.usage.outputTokens, 'output tokens'),
      reasoningTokens: count(generated.reasoningTokens, 'reasoning tokens'),
      latencyMs: generated.latencyMs,
      finishState: 'completed',
    })
    return {
      status: 'completed',
      agentRunId: finalized.agentRunId,
      terraEscalationRequested: finalized.terraEscalationRequested,
      providerCallState: 'completed',
      paperOrdersCreated: finalized.paperOrdersCreated,
      paperFillsCreated: finalized.paperFillsCreated,
      ledgerEntriesCreated: finalized.ledgerEntriesCreated,
      replayed: finalized.replayed,
    }
  } catch (error) {
    const reason = error instanceof Error ? error.name : 'unknown_error'
    return markLunaUnknown(dependencies, input, begin, reason)
  }
}

export async function runHostedShadowProposalWithDependencies(
  input: HostedShadowProposalInput,
  dependencies: HostedAgentRuntimeDependencies,
): Promise<HostedShadowProposalRunResult> {
  const serializedContext = validateInput(input)
  const limits =
    input.role === 'terra'
      ? { input: 12_000, output: 1_500, effort: 'medium' as const }
      : { input: 16_000, output: 2_000, effort: 'high' as const }
  const begin = await dependencies.begin({
    ownerId: input.ownerId,
    operationId: input.operationId,
    experimentId: input.experimentId,
    expectedControlStateVersion: input.expectedControlStateVersion,
    decisionAt: input.decisionAt,
    role: input.role,
    parentAgentRunId: input.parentAgentRunId,
    routingReason: input.routingReason,
    candidateCount: 1,
    maxInputTokens: limits.input,
    maxOutputTokens: limits.output,
    maxToolCalls: 0,
  })
  if (!begin.allowed || !begin.reservationId) {
    return {
      status: 'skipped',
      reason: begin.reason,
      providerCallState: 'not_started',
      paperOrdersCreated: 0,
      paperFillsCreated: 0,
      ledgerEntriesCreated: 0,
    }
  }
  if (begin.outputSchema.$id !== TRADE_PROPOSAL_SCHEMA_ID) {
    await dependencies.fail({
      ownerId: input.ownerId,
      agentRunId: begin.agentRunId,
      reservationId: begin.reservationId,
      reservationOutcome: 'released',
      errorClass: 'prompt_schema_contract_mismatch',
    })
    return {
      status: 'skipped',
      reason: 'prompt_schema_contract_mismatch',
      providerCallState: 'not_started',
      paperOrdersCreated: 0,
      paperFillsCreated: 0,
      ledgerEntriesCreated: 0,
    }
  }

  try {
    const generated = await dependencies.gateway.generateStructured({
      model: begin.model as 'gpt-5.6-terra' | 'gpt-5.6-sol',
      schemaName: `${input.role}_trade_proposal`,
      schema: tradeProposalSchema,
      system: begin.systemPrompt,
      input: serializedContext,
      maxOutputTokens: limits.output,
      reasoningEffort: limits.effort,
    })
    const proposal = validateProposalSemantics(generated.output)
    if (!proposalEvidenceMatches(proposal.evidenceIds, input.evidence)) {
      return markUnknown(
        dependencies,
        input,
        begin,
        'provider_evidence_mismatch',
      )
    }
    const finalized = await dependencies.finalize({
      ownerId: input.ownerId,
      agentRunId: begin.agentRunId,
      reservationId: begin.reservationId,
      providerResponseId: generated.responseId,
      contextManifest: input.contextManifest,
      structuredOutput: asJson(proposal),
      conciseRationale: proposal.thesis,
      confidence: confidenceFraction(proposal.confidencePercent),
      evidence: asJson(input.evidence),
      inputTokens: count(
        generated.providerInputTokens,
        'provider input tokens',
      ),
      cachedInputTokens: count(
        generated.usage.cachedInputTokens,
        'cached input tokens',
      ),
      cacheWriteTokens: count(
        generated.usage.cacheWriteTokens,
        'cache-write tokens',
      ),
      outputTokens: count(generated.usage.outputTokens, 'output tokens'),
      reasoningTokens: count(generated.reasoningTokens, 'reasoning tokens'),
      latencyMs: generated.latencyMs,
      finishState: 'completed',
    })
    return {
      status: 'completed',
      agentRunId: finalized.agentRunId,
      decisionId: finalized.decisionId,
      providerCallState: 'completed',
      paperOrdersCreated: finalized.paperOrdersCreated,
      paperFillsCreated: finalized.paperFillsCreated,
      ledgerEntriesCreated: finalized.ledgerEntriesCreated,
      replayed: finalized.replayed,
    }
  } catch (error) {
    const reason = error instanceof Error ? error.name : 'unknown_error'
    return markUnknown(dependencies, input, begin, reason)
  }
}

export async function runHostedShadowProposal(
  input: HostedShadowProposalInput,
): Promise<HostedShadowProposalRunResult> {
  let environment
  try {
    environment = getServerEnvironment()
  } catch {
    return {
      status: 'disabled',
      reason: 'environment_invalid',
      providerCallState: 'not_started',
      paperOrdersCreated: 0,
      paperFillsCreated: 0,
      ledgerEntriesCreated: 0,
    }
  }
  const readiness = deriveHostedAgentRuntimeReadiness(environment)
  if (!readiness.ready) {
    return {
      status: 'disabled',
      reason: readiness.code,
      providerCallState: 'not_started',
      paperOrdersCreated: 0,
      paperFillsCreated: 0,
      ledgerEntriesCreated: 0,
    }
  }
  const client = createSupabaseAdminClient()
  if (!client) {
    throw new Error('Hosted agent runtime is unavailable')
  }
  return runHostedShadowProposalWithDependencies(input, {
    gateway: createOpenAIGateway(),
    begin: (request) => beginHostedAgentRun(client, request),
    finalize: (request) => finalizeHostedShadowProposal(client, request),
    fail: (request) => failHostedAgentRun(client, request),
  })
}

export async function runHostedLuna(
  input: HostedLunaInput,
): Promise<HostedLunaRunResult> {
  let environment
  try {
    environment = getServerEnvironment()
  } catch {
    return {
      status: 'disabled',
      reason: 'environment_invalid',
      providerCallState: 'not_started',
      paperOrdersCreated: 0,
      paperFillsCreated: 0,
      ledgerEntriesCreated: 0,
    }
  }
  const readiness = deriveHostedAgentRuntimeReadiness(environment)
  if (!readiness.ready) {
    return {
      status: 'disabled',
      reason: readiness.code,
      providerCallState: 'not_started',
      paperOrdersCreated: 0,
      paperFillsCreated: 0,
      ledgerEntriesCreated: 0,
    }
  }
  const client = createSupabaseAdminClient()
  if (!client) throw new Error('Hosted Luna runtime is unavailable')
  return runHostedLunaWithDependencies(input, {
    gateway: createOpenAIGateway(),
    begin: (request) => beginHostedAgentRun(client, request),
    finalize: (request) => finalizeHostedLunaRun(client, request),
    fail: (request) => failHostedAgentRun(client, request),
  })
}
