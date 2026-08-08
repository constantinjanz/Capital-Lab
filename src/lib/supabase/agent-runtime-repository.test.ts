import { afterEach, describe, expect, it, vi } from 'vitest'

const logMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/logging/logger', () => ({ log: logMock }))

import type { HostedAgentRuntimeClient } from './agent-runtime-repository'
import {
  beginHostedAgentRun,
  failHostedAgentRun,
  finalizeHostedLunaRun,
  finalizeHostedShadowProposal,
} from './agent-runtime-repository'

const ownerId = '00000000-0000-4000-8000-000000000001'
const operationId = '10000000-0000-4000-8000-000000000001'
const experimentId = '20000000-0000-4000-8000-000000000001'
const runId = '30000000-0000-4000-8000-000000000001'
const reservationId = '40000000-0000-4000-8000-000000000001'
const promptVersionId = '50000000-0000-4000-8000-000000000001'
const contextId = '60000000-0000-4000-8000-000000000001'
const decisionId = '70000000-0000-4000-8000-000000000001'

function clientReturning(data: unknown) {
  const rpc = vi.fn().mockResolvedValue({ data, error: null })
  return { client: { rpc } as unknown as HostedAgentRuntimeClient, rpc }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('hosted agent runtime repository', () => {
  it('maps an atomic begin reservation and sends every cap to the RPC', async () => {
    const fixture = clientReturning([
      {
        allowed: true,
        agent_run_id: runId,
        reservation_id: reservationId,
        model: 'gpt-5.6-terra',
        prompt_version_id: promptVersionId,
        system_prompt: 'Pinned owner prompt.',
        output_schema: { type: 'object' },
        reason: 'budget_reserved',
        replayed: false,
      },
    ])

    await expect(
      beginHostedAgentRun(fixture.client, {
        ownerId,
        operationId,
        experimentId,
        expectedControlStateVersion: '42',
        decisionAt: '2026-08-09T12:00:00.000Z',
        role: 'terra',
        parentAgentRunId: null,
        routingReason: 'exceptional_deterministic_trigger',
        candidateCount: 1,
        maxInputTokens: 12000,
        maxOutputTokens: 1500,
        maxToolCalls: 0,
      }),
    ).resolves.toMatchObject({
      allowed: true,
      agentRunId: runId,
      reservationId,
      model: 'gpt-5.6-terra',
    })
    expect(fixture.rpc).toHaveBeenCalledWith('begin_hosted_agent_run', {
      p_owner_id: ownerId,
      p_operation_id: operationId,
      p_experiment_id: experimentId,
      p_expected_control_state_version: '42',
      p_decision_at: '2026-08-09T12:00:00.000Z',
      p_role: 'terra',
      p_parent_agent_run_id: null,
      p_routing_reason: 'exceptional_deterministic_trigger',
      p_candidate_count: 1,
      p_max_input_tokens: 12000,
      p_max_output_tokens: 1500,
      p_max_tool_calls: 0,
    })
  })

  it('rejects a begin result without matching budget evidence', async () => {
    const fixture = clientReturning([
      {
        allowed: true,
        agent_run_id: runId,
        reservation_id: null,
        model: 'gpt-5.6-terra',
        prompt_version_id: promptVersionId,
        system_prompt: 'Pinned owner prompt.',
        output_schema: { type: 'object' },
        reason: 'budget_reserved',
        replayed: false,
      },
    ])

    await expect(
      beginHostedAgentRun(fixture.client, {
        ownerId,
        operationId,
        experimentId,
        expectedControlStateVersion: '42',
        decisionAt: '2026-08-09T12:00:00.000Z',
        role: 'terra',
        parentAgentRunId: null,
        routingReason: 'exceptional_deterministic_trigger',
        candidateCount: 1,
        maxInputTokens: 12000,
        maxOutputTokens: 1500,
        maxToolCalls: 0,
      }),
    ).rejects.toThrow('Hosted agent runtime database operation failed')
  })

  it('rejects a begin result whose model does not match the requested role', async () => {
    const fixture = clientReturning([
      {
        allowed: true,
        agent_run_id: runId,
        reservation_id: reservationId,
        model: 'gpt-5.6-sol',
        prompt_version_id: promptVersionId,
        system_prompt: 'Pinned owner prompt.',
        output_schema: { type: 'object' },
        reason: 'budget_reserved',
        replayed: false,
      },
    ])

    await expect(
      beginHostedAgentRun(fixture.client, {
        ownerId,
        operationId,
        experimentId,
        expectedControlStateVersion: '42',
        decisionAt: '2026-08-09T12:00:00.000Z',
        role: 'terra',
        parentAgentRunId: null,
        routingReason: 'exceptional_deterministic_trigger',
        candidateCount: 1,
        maxInputTokens: 12000,
        maxOutputTokens: 1500,
        maxToolCalls: 0,
      }),
    ).rejects.toThrow('Hosted agent runtime database operation failed')
  })

  it('accepts only a zero-side-effect shadow finalization result', async () => {
    const fixture = clientReturning([
      {
        agent_run_id: runId,
        context_snapshot_id: contextId,
        decision_id: decisionId,
        proposal_status: 'shadow',
        model_calls: 1,
        paper_orders_created: 0,
        paper_fills_created: 0,
        ledger_entries_created: 0,
        replayed: false,
      },
    ])

    await expect(
      finalizeHostedShadowProposal(fixture.client, {
        ownerId,
        agentRunId: runId,
        reservationId,
        providerResponseId: 'response-1',
        contextManifest: { contractVersion: 1 },
        structuredOutput: { decisionType: 'abstain' },
        conciseRationale: 'No paper exposure.',
        confidence: '0.5',
        evidence: [],
        inputTokens: 20,
        cachedInputTokens: 5,
        cacheWriteTokens: 0,
        outputTokens: 10,
        reasoningTokens: 2,
        latencyMs: 100,
        finishState: 'completed',
      }),
    ).resolves.toEqual({
      agentRunId: runId,
      contextSnapshotId: contextId,
      decisionId,
      proposalStatus: 'shadow',
      modelCalls: 1,
      paperOrdersCreated: 0,
      paperFillsCreated: 0,
      ledgerEntriesCreated: 0,
      replayed: false,
    })

    fixture.rpc.mockResolvedValueOnce({
      data: [
        {
          agent_run_id: runId,
          context_snapshot_id: contextId,
          decision_id: decisionId,
          proposal_status: 'shadow',
          model_calls: 1,
          paper_orders_created: 1,
          paper_fills_created: 0,
          ledger_entries_created: 0,
          replayed: false,
        },
      ],
      error: null,
    })
    await expect(
      finalizeHostedShadowProposal(fixture.client, {
        ownerId,
        agentRunId: runId,
        reservationId,
        providerResponseId: 'response-1',
        contextManifest: {},
        structuredOutput: {},
        conciseRationale: 'No paper exposure.',
        confidence: '0.5',
        evidence: [],
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        latencyMs: 0,
        finishState: 'completed',
      }),
    ).rejects.toThrow('Hosted agent runtime database operation failed')
  })

  it('maps a completed Luna finalization with no execution side effects', async () => {
    const fixture = clientReturning([
      {
        agent_run_id: runId,
        status: 'completed',
        terra_escalation_requested: true,
        model_calls: 1,
        paper_orders_created: 0,
        paper_fills_created: 0,
        ledger_entries_created: 0,
        replayed: false,
      },
    ])

    await expect(
      finalizeHostedLunaRun(fixture.client, {
        ownerId,
        agentRunId: runId,
        reservationId,
        providerResponseId: 'response-luna-1',
        output: { candidates: [] },
        inputTokens: 20,
        cachedInputTokens: 5,
        cacheWriteTokens: 0,
        outputTokens: 10,
        reasoningTokens: 2,
        latencyMs: 100,
        finishState: 'completed',
      }),
    ).resolves.toEqual({
      agentRunId: runId,
      status: 'completed',
      terraEscalationRequested: true,
      modelCalls: 1,
      paperOrdersCreated: 0,
      paperFillsCreated: 0,
      ledgerEntriesCreated: 0,
      replayed: false,
    })
    expect(fixture.rpc).toHaveBeenCalledWith('finalize_hosted_luna_run', {
      p_owner_id: ownerId,
      p_agent_run_id: runId,
      p_reservation_id: reservationId,
      p_provider_response_id: 'response-luna-1',
      p_output: { candidates: [] },
      p_input_tokens: 20,
      p_cached_input_tokens: 5,
      p_cache_write_tokens: 0,
      p_output_tokens: 10,
      p_reasoning_tokens: 2,
      p_latency_ms: 100,
      p_finish_state: 'completed',
    })
  })

  it('maps an explicit unknown-cost failure without claiming a model count', async () => {
    const fixture = clientReturning([
      {
        agent_run_id: runId,
        status: 'unknown',
        reservation_status: 'unknown',
        model_calls: 0,
        paper_orders_created: 0,
        paper_fills_created: 0,
        ledger_entries_created: 0,
        replayed: false,
      },
    ])

    await expect(
      failHostedAgentRun(fixture.client, {
        ownerId,
        agentRunId: runId,
        reservationId,
        reservationOutcome: 'unknown',
        errorClass: 'provider_transport_unknown',
      }),
    ).resolves.toMatchObject({
      status: 'unknown',
      reservationStatus: 'unknown',
      modelCalls: 0,
      paperOrdersCreated: 0,
    })
  })
})
