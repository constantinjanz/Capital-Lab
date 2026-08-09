import { describe, expect, it, vi } from 'vitest'

import type { TradeProposal } from '@/domain/agent/schemas'
import type { OpenAIGateway } from '@/providers/openai/types'

import {
  runHostedShadowProposalWithDependencies,
  type HostedAgentRuntimeDependencies,
  type HostedShadowProposalInput,
} from './hosted-agent-runtime'

const ownerId = '00000000-0000-4000-8000-000000000001'
const operationId = '10000000-0000-4000-8000-000000000001'
const experimentId = '20000000-0000-4000-8000-000000000001'
const runId = '30000000-0000-4000-8000-000000000001'
const reservationId = '40000000-0000-4000-8000-000000000001'
const promptVersionId = '50000000-0000-4000-8000-000000000001'
const decisionId = '60000000-0000-4000-8000-000000000001'
const evidenceId = '70000000-0000-4000-8000-000000000001'

const proposal: TradeProposal = {
  decisionType: 'abstain',
  eventIds: [],
  evidenceIds: [evidenceId],
  thesis: 'Point-in-time evidence remains insufficient.',
  scenarios: {
    bull: { summary: 'Evidence improves.', probabilityPercent: 20 },
    base: { summary: 'Evidence remains mixed.', probabilityPercent: 60 },
    bear: { summary: 'Evidence weakens.', probabilityPercent: 20 },
  },
  confidencePercent: 60,
  expectedDirection: 'uncertain',
  expectedReturnRangeBps: { minimum: '-25', maximum: '50.5' },
  intendedHorizon: '1_hour',
  invalidationConditions: ['New evidence changes the assessment.'],
  urgency: 'normal',
  escalationRequested: false,
  abstentionReason: 'No bounded paper exposure is justified.',
}

const input: HostedShadowProposalInput = {
  ownerId,
  operationId,
  experimentId,
  expectedControlStateVersion: '42',
  decisionAt: '2026-08-09T12:00:00.000Z',
  role: 'terra',
  parentAgentRunId: null,
  routingReason: 'exceptional_deterministic_trigger',
  contextManifest: { contractVersion: 1, evidenceText: 'Untrusted fixture.' },
  evidence: [
    {
      kind: 'knowledge',
      id: evidenceId,
      citationLabel: 'knowledge:reviewed-source',
    },
  ],
}

function dependencies(): HostedAgentRuntimeDependencies & {
  begin: ReturnType<typeof vi.fn>
  finalize: ReturnType<typeof vi.fn>
  fail: ReturnType<typeof vi.fn>
  generateStructured: ReturnType<typeof vi.fn>
} {
  const generateStructured = vi.fn().mockResolvedValue({
    responseId: 'response-1',
    output: proposal,
    usage: {
      inputTokens: '15',
      cachedInputTokens: '5',
      cacheWriteTokens: '0',
      outputTokens: '10',
      webSearchCalls: '0',
    },
    providerInputTokens: '20',
    reasoningTokens: '2',
    latencyMs: 125,
    finishState: 'completed',
  })
  const gateway = {
    generateStructured,
    researchWeb: vi.fn(),
  } as unknown as OpenAIGateway
  const begin = vi.fn().mockResolvedValue({
    allowed: true,
    agentRunId: runId,
    reservationId,
    model: 'gpt-5.6-terra',
    promptVersionId,
    systemPrompt: 'Pinned owner prompt.',
    outputSchema: {
      $id: 'capital_lab_trade_proposal_v1',
      type: 'object',
    },
    reason: 'budget_reserved',
    replayed: false,
  })
  const finalize = vi.fn().mockResolvedValue({
    agentRunId: runId,
    decisionId,
    paperOrdersCreated: 0,
    paperFillsCreated: 0,
    ledgerEntriesCreated: 0,
    replayed: false,
  })
  const fail = vi.fn().mockResolvedValue({ status: 'unknown' })
  return { gateway, generateStructured, begin, finalize, fail }
}

describe('runHostedShadowProposalWithDependencies', () => {
  it('does not call the provider when the atomic database guard denies the run', async () => {
    const fixture = dependencies()
    fixture.begin.mockResolvedValue({
      allowed: false,
      agentRunId: runId,
      reservationId: null,
      model: 'gpt-5.6-terra',
      promptVersionId,
      systemPrompt: 'Pinned owner prompt.',
      outputSchema: {
        $id: 'capital_lab_trade_proposal_v1',
        type: 'object',
      },
      reason: 'call_limit',
      replayed: false,
    })

    await expect(
      runHostedShadowProposalWithDependencies(input, fixture),
    ).resolves.toEqual({
      status: 'skipped',
      reason: 'call_limit',
      providerCallState: 'not_started',
      paperOrdersCreated: 0,
      paperFillsCreated: 0,
      ledgerEntriesCreated: 0,
    })
    expect(fixture.generateStructured).not.toHaveBeenCalled()
    expect(fixture.finalize).not.toHaveBeenCalled()
  })

  it('uses the pinned prompt and persists total provider input with zero side effects', async () => {
    const fixture = dependencies()

    await expect(
      runHostedShadowProposalWithDependencies(input, fixture),
    ).resolves.toEqual({
      status: 'completed',
      agentRunId: runId,
      decisionId,
      providerCallState: 'completed',
      paperOrdersCreated: 0,
      paperFillsCreated: 0,
      ledgerEntriesCreated: 0,
      replayed: false,
    })
    expect(fixture.generateStructured).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-5.6-terra',
        system: 'Pinned owner prompt.',
        maxOutputTokens: 1500,
        reasoningEffort: 'medium',
      }),
    )
    expect(fixture.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        inputTokens: 20,
        cachedInputTokens: 5,
        outputTokens: 10,
        reasoningTokens: 2,
        confidence: '0.6',
        conciseRationale: proposal.thesis,
      }),
    )
    expect(fixture.fail).not.toHaveBeenCalled()
  })

  it('releases the reservation before any call when the pinned schema contract drifts', async () => {
    const fixture = dependencies()
    fixture.begin.mockResolvedValue({
      allowed: true,
      agentRunId: runId,
      reservationId,
      model: 'gpt-5.6-terra',
      promptVersionId,
      systemPrompt: 'Pinned owner prompt.',
      outputSchema: { type: 'object' },
      reason: 'budget_reserved',
      replayed: false,
    })

    await expect(
      runHostedShadowProposalWithDependencies(input, fixture),
    ).resolves.toMatchObject({
      status: 'skipped',
      reason: 'prompt_schema_contract_mismatch',
      providerCallState: 'not_started',
    })
    expect(fixture.generateStructured).not.toHaveBeenCalled()
    expect(fixture.fail).toHaveBeenCalledWith({
      ownerId,
      agentRunId: runId,
      reservationId,
      reservationOutcome: 'released',
      errorClass: 'prompt_schema_contract_mismatch',
    })
  })

  it('marks cost unknown when the provider request cannot be reconciled', async () => {
    const fixture = dependencies()
    fixture.generateStructured.mockRejectedValue(new Error('transport detail'))

    await expect(
      runHostedShadowProposalWithDependencies(input, fixture),
    ).resolves.toMatchObject({
      status: 'failed_unknown_cost',
      agentRunId: runId,
      providerCallState: 'unknown',
      paperOrdersCreated: 0,
    })
    expect(fixture.fail).toHaveBeenCalledWith({
      ownerId,
      agentRunId: runId,
      reservationId,
      reservationOutcome: 'unknown',
      errorClass: 'Error',
    })
  })

  it('does not persist a proposal that cites a different evidence set', async () => {
    const fixture = dependencies()
    fixture.generateStructured.mockResolvedValue({
      responseId: 'response-2',
      output: {
        ...proposal,
        evidenceIds: ['80000000-0000-4000-8000-000000000001'],
      },
      usage: {
        inputTokens: '10',
        cachedInputTokens: '0',
        cacheWriteTokens: '0',
        outputTokens: '10',
        webSearchCalls: '0',
      },
      providerInputTokens: '10',
      reasoningTokens: '0',
      latencyMs: 100,
      finishState: 'completed',
    })

    await expect(
      runHostedShadowProposalWithDependencies(input, fixture),
    ).resolves.toMatchObject({
      status: 'failed_unknown_cost',
      reason: 'provider_evidence_mismatch',
    })
    expect(fixture.finalize).not.toHaveBeenCalled()
    expect(fixture.fail).toHaveBeenCalledOnce()
  })
})
