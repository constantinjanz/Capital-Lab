import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { log } from '@/lib/logging/logger'
import type { Database, Json } from '@/lib/supabase/database.types'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type UnknownRow = Record<string, unknown>
export type HostedAgentRuntimeClient = SupabaseClient<Database>
export type HostedProposalRole = 'terra' | 'sol'

export type BeginHostedAgentRunInput = {
  ownerId: string
  operationId: string
  experimentId: string
  expectedControlStateVersion: string
  decisionAt: string
  role: 'luna' | HostedProposalRole
  parentAgentRunId: string | null
  routingReason: string
  candidateCount: number
  maxInputTokens: number
  maxOutputTokens: number
  maxToolCalls: number
}

export type BeginHostedAgentRunResult = {
  allowed: boolean
  agentRunId: string
  reservationId: string | null
  model: 'gpt-5.6-luna' | 'gpt-5.6-terra' | 'gpt-5.6-sol'
  promptVersionId: string
  systemPrompt: string
  outputSchema: UnknownRow
  reason: string
  replayed: boolean
}

export type FinalizeHostedShadowProposalInput = {
  ownerId: string
  agentRunId: string
  reservationId: string
  providerResponseId: string
  contextManifest: Json
  structuredOutput: Json
  conciseRationale: string
  confidence: string
  evidence: Json
  inputTokens: number
  cachedInputTokens: number
  cacheWriteTokens: number
  outputTokens: number
  reasoningTokens: number
  latencyMs: number
  finishState: 'completed'
}

export type FinalizeHostedLunaRunInput = {
  ownerId: string
  agentRunId: string
  reservationId: string
  providerResponseId: string
  output: Json
  inputTokens: number
  cachedInputTokens: number
  cacheWriteTokens: number
  outputTokens: number
  reasoningTokens: number
  latencyMs: number
  finishState: 'completed'
}

export type FinalizeHostedLunaRunResult = {
  agentRunId: string
  status: 'completed'
  terraEscalationRequested: boolean
  modelCalls: 1
  paperOrdersCreated: 0
  paperFillsCreated: 0
  ledgerEntriesCreated: 0
  replayed: boolean
}

export type FinalizeHostedShadowProposalResult = {
  agentRunId: string
  contextSnapshotId: string
  decisionId: string
  proposalStatus: 'shadow'
  modelCalls: 1
  paperOrdersCreated: 0
  paperFillsCreated: 0
  ledgerEntriesCreated: 0
  replayed: boolean
}

export type FailHostedAgentRunInput = {
  ownerId: string
  agentRunId: string
  reservationId: string
  reservationOutcome: 'released' | 'unknown'
  errorClass: string
}

export type FailHostedAgentRunResult = {
  agentRunId: string
  status: 'failed' | 'unknown'
  reservationStatus: 'released' | 'unknown'
  modelCalls: 0
  paperOrdersCreated: 0
  paperFillsCreated: 0
  ledgerEntriesCreated: 0
  replayed: boolean
}

class HostedAgentRuntimeRepositoryError extends Error {
  constructor(readonly operation: string) {
    super('Hosted agent runtime database operation failed')
    this.name = 'HostedAgentRuntimeRepositoryError'
  }
}

function row(value: unknown, label: string): UnknownRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Hosted agent runtime has an invalid ${label}`)
  }
  return value as UnknownRow
}

function oneRow(value: unknown, label: string): UnknownRow {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new Error(`Hosted agent runtime has invalid ${label}`)
  }
  return row(value[0], label)
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Hosted agent runtime has an invalid ${label}`)
  }
  return value
}

function uuid(value: unknown, label: string): string {
  const result = text(value, label)
  if (!UUID_PATTERN.test(result)) {
    throw new Error(`Hosted agent runtime has an invalid ${label}`)
  }
  return result
}

function nullableUuid(value: unknown, label: string): string | null {
  return value === null ? null : uuid(value, label)
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`Hosted agent runtime has an invalid ${label}`)
  }
  return value
}

function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`Hosted agent runtime has an invalid ${label}`)
  }
  return value as number
}

function exactInteger<T extends number>(
  value: unknown,
  expected: T,
  label: string,
): T {
  if (integer(value, label) !== expected) {
    throw new Error(`Hosted agent runtime has an unsafe ${label}`)
  }
  return expected
}

function model(value: unknown): BeginHostedAgentRunResult['model'] {
  const result = text(value, 'model')
  if (!['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol'].includes(result)) {
    throw new Error('Hosted agent runtime has an invalid model')
  }
  return result as BeginHostedAgentRunResult['model']
}

async function rpc(
  client: HostedAgentRuntimeClient,
  operation: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  let result: { data: unknown; error: unknown }
  try {
    result = (await client.rpc(
      operation as keyof Database['public']['Functions'],
      args as never,
    )) as { data: unknown; error: unknown }
  } catch {
    throw new HostedAgentRuntimeRepositoryError(operation)
  }
  if (result.error) throw new HostedAgentRuntimeRepositoryError(operation)
  return result.data
}

async function safely<T>(
  operation: string,
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work()
  } catch (error) {
    log('error', 'Hosted agent runtime database operation failed', {
      operation,
      errorClass: error instanceof Error ? error.name : 'UnknownThrownValue',
    })
    throw new Error('Hosted agent runtime database operation failed')
  }
}

export async function beginHostedAgentRun(
  client: HostedAgentRuntimeClient,
  input: BeginHostedAgentRunInput,
): Promise<BeginHostedAgentRunResult> {
  return safely('begin_hosted_agent_run', async () => {
    const result = oneRow(
      await rpc(client, 'begin_hosted_agent_run', {
        p_owner_id: input.ownerId,
        p_operation_id: input.operationId,
        p_experiment_id: input.experimentId,
        p_expected_control_state_version: input.expectedControlStateVersion,
        p_decision_at: input.decisionAt,
        p_role: input.role,
        p_parent_agent_run_id: input.parentAgentRunId,
        p_routing_reason: input.routingReason,
        p_candidate_count: input.candidateCount,
        p_max_input_tokens: input.maxInputTokens,
        p_max_output_tokens: input.maxOutputTokens,
        p_max_tool_calls: input.maxToolCalls,
      }),
      'begin result',
    )
    const allowed = boolean(result.allowed, 'allowed flag')
    const reservationId = nullableUuid(result.reservation_id, 'reservation id')
    if (allowed !== (reservationId !== null)) {
      throw new Error('Hosted agent runtime has inconsistent budget evidence')
    }
    const returnedModel = model(result.model)
    const expectedModel = `gpt-5.6-${input.role}`
    if (returnedModel !== expectedModel) {
      throw new Error('Hosted agent runtime has inconsistent model evidence')
    }
    const outputSchema = row(result.output_schema, 'output schema')
    return {
      allowed,
      agentRunId: uuid(result.agent_run_id, 'agent run id'),
      reservationId,
      model: returnedModel,
      promptVersionId: uuid(result.prompt_version_id, 'prompt version id'),
      systemPrompt: text(result.system_prompt, 'system prompt'),
      outputSchema,
      reason: text(result.reason, 'routing reason'),
      replayed: boolean(result.replayed, 'replayed flag'),
    }
  })
}

export async function finalizeHostedShadowProposal(
  client: HostedAgentRuntimeClient,
  input: FinalizeHostedShadowProposalInput,
): Promise<FinalizeHostedShadowProposalResult> {
  return safely('finalize_hosted_shadow_proposal', async () => {
    const result = oneRow(
      await rpc(client, 'finalize_hosted_shadow_proposal', {
        p_owner_id: input.ownerId,
        p_agent_run_id: input.agentRunId,
        p_reservation_id: input.reservationId,
        p_provider_response_id: input.providerResponseId,
        p_context_manifest: input.contextManifest,
        p_structured_output: input.structuredOutput,
        p_concise_rationale: input.conciseRationale,
        p_confidence: input.confidence,
        p_evidence: input.evidence,
        p_input_tokens: input.inputTokens,
        p_cached_input_tokens: input.cachedInputTokens,
        p_cache_write_tokens: input.cacheWriteTokens,
        p_output_tokens: input.outputTokens,
        p_reasoning_tokens: input.reasoningTokens,
        p_latency_ms: input.latencyMs,
        p_finish_state: input.finishState,
      }),
      'finalization result',
    )
    if (text(result.proposal_status, 'proposal status') !== 'shadow') {
      throw new Error('Hosted agent runtime returned a non-shadow proposal')
    }
    return {
      agentRunId: uuid(result.agent_run_id, 'agent run id'),
      contextSnapshotId: uuid(
        result.context_snapshot_id,
        'context snapshot id',
      ),
      decisionId: uuid(result.decision_id, 'decision id'),
      proposalStatus: 'shadow',
      modelCalls: exactInteger(result.model_calls, 1, 'model call count'),
      paperOrdersCreated: exactInteger(
        result.paper_orders_created,
        0,
        'paper order count',
      ),
      paperFillsCreated: exactInteger(
        result.paper_fills_created,
        0,
        'paper fill count',
      ),
      ledgerEntriesCreated: exactInteger(
        result.ledger_entries_created,
        0,
        'ledger entry count',
      ),
      replayed: boolean(result.replayed, 'replayed flag'),
    }
  })
}

export async function finalizeHostedLunaRun(
  client: HostedAgentRuntimeClient,
  input: FinalizeHostedLunaRunInput,
): Promise<FinalizeHostedLunaRunResult> {
  return safely('finalize_hosted_luna_run', async () => {
    const result = oneRow(
      await rpc(client, 'finalize_hosted_luna_run', {
        p_owner_id: input.ownerId,
        p_agent_run_id: input.agentRunId,
        p_reservation_id: input.reservationId,
        p_provider_response_id: input.providerResponseId,
        p_output: input.output,
        p_input_tokens: input.inputTokens,
        p_cached_input_tokens: input.cachedInputTokens,
        p_cache_write_tokens: input.cacheWriteTokens,
        p_output_tokens: input.outputTokens,
        p_reasoning_tokens: input.reasoningTokens,
        p_latency_ms: input.latencyMs,
        p_finish_state: input.finishState,
      }),
      'Luna finalization result',
    )
    if (text(result.status, 'run status') !== 'completed') {
      throw new Error('Hosted agent runtime returned an incomplete Luna run')
    }
    return {
      agentRunId: uuid(result.agent_run_id, 'agent run id'),
      status: 'completed',
      terraEscalationRequested: boolean(
        result.terra_escalation_requested,
        'Terra escalation flag',
      ),
      modelCalls: exactInteger(result.model_calls, 1, 'model call count'),
      paperOrdersCreated: exactInteger(
        result.paper_orders_created,
        0,
        'paper order count',
      ),
      paperFillsCreated: exactInteger(
        result.paper_fills_created,
        0,
        'paper fill count',
      ),
      ledgerEntriesCreated: exactInteger(
        result.ledger_entries_created,
        0,
        'ledger entry count',
      ),
      replayed: boolean(result.replayed, 'replayed flag'),
    }
  })
}

export async function failHostedAgentRun(
  client: HostedAgentRuntimeClient,
  input: FailHostedAgentRunInput,
): Promise<FailHostedAgentRunResult> {
  return safely('fail_hosted_agent_run', async () => {
    const result = oneRow(
      await rpc(client, 'fail_hosted_agent_run', {
        p_owner_id: input.ownerId,
        p_agent_run_id: input.agentRunId,
        p_reservation_id: input.reservationId,
        p_reservation_outcome: input.reservationOutcome,
        p_error_class: input.errorClass,
      }),
      'failure result',
    )
    const status = text(result.status, 'run status')
    const reservationStatus = text(
      result.reservation_status,
      'reservation status',
    )
    if (
      !['failed', 'unknown'].includes(status) ||
      !['released', 'unknown'].includes(reservationStatus) ||
      (status === 'failed') !== (reservationStatus === 'released')
    ) {
      throw new Error(
        'Hosted agent runtime returned inconsistent failure state',
      )
    }
    return {
      agentRunId: uuid(result.agent_run_id, 'agent run id'),
      status: status as FailHostedAgentRunResult['status'],
      reservationStatus:
        reservationStatus as FailHostedAgentRunResult['reservationStatus'],
      modelCalls: exactInteger(result.model_calls, 0, 'model call count'),
      paperOrdersCreated: exactInteger(
        result.paper_orders_created,
        0,
        'paper order count',
      ),
      paperFillsCreated: exactInteger(
        result.paper_fills_created,
        0,
        'paper fill count',
      ),
      ledgerEntriesCreated: exactInteger(
        result.ledger_entries_created,
        0,
        'ledger entry count',
      ),
      replayed: boolean(result.replayed, 'replayed flag'),
    }
  })
}
