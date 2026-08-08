import { describe, expect, it, vi } from 'vitest'

import type { OpenAIGateway } from '@/providers/openai/types'

import {
  runHostedLunaWithDependencies,
  type HostedLunaInput,
  type HostedLunaRuntimeDependencies,
} from './hosted-agent-runtime'

const ownerId = '00000000-0000-4000-8000-000000000001'
const operationId = '10000000-0000-4000-8000-000000000001'
const experimentId = '20000000-0000-4000-8000-000000000001'
const runId = '30000000-0000-4000-8000-000000000001'
const reservationId = '40000000-0000-4000-8000-000000000001'
const promptVersionId = '50000000-0000-4000-8000-000000000001'

const input: HostedLunaInput = {
  ownerId,
  operationId,
  experimentId,
  expectedControlStateVersion: '42',
  decisionAt: '2026-08-10T14:00:00.000Z',
  candidates: [
    {
      candidateId: 'event-1',
      data: { title: 'Untrusted point-in-time candidate.' },
    },
  ],
}

const lunaOutput = {
  candidates: [
    {
      candidateId: 'event-1',
      relevant: true,
      materialityScore: 80,
      noveltyScore: 60,
      urgency: 'normal' as const,
      linkedSymbols: ['SPY'],
      eventCategory: 'macro',
      expectedHorizon: '1_hour' as const,
      reasonSummary: 'The candidate is material to the paper portfolio.',
      escalateToTerra: true,
    },
  ],
}

function dependencies(): HostedLunaRuntimeDependencies & {
  begin: ReturnType<typeof vi.fn>
  finalize: ReturnType<typeof vi.fn>
  fail: ReturnType<typeof vi.fn>
  generateStructured: ReturnType<typeof vi.fn>
} {
  const generateStructured = vi.fn().mockResolvedValue({
    responseId: 'luna-response-1',
    output: lunaOutput,
    usage: {
      inputTokens: '18',
      cachedInputTokens: '2',
      cacheWriteTokens: '0',
      outputTokens: '12',
      webSearchCalls: '0',
    },
    providerInputTokens: '20',
    reasoningTokens: '1',
    latencyMs: 80,
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
    model: 'gpt-5.6-luna',
    promptVersionId,
    systemPrompt: 'Pinned Luna prompt.',
    outputSchema: {
      $id: 'capital_lab_luna_decision_v1',
      type: 'object',
    },
    reason: 'budget_reserved',
    replayed: false,
  })
  const finalize = vi.fn().mockResolvedValue({
    agentRunId: runId,
    terraEscalationRequested: true,
    paperOrdersCreated: 0,
    paperFillsCreated: 0,
    ledgerEntriesCreated: 0,
    replayed: false,
  })
  const fail = vi.fn().mockResolvedValue({ status: 'unknown' })
  return { gateway, generateStructured, begin, finalize, fail }
}

describe('runHostedLunaWithDependencies', () => {
  it('persists one complete Luna relevance result without execution side effects', async () => {
    const fixture = dependencies()

    await expect(
      runHostedLunaWithDependencies(input, fixture),
    ).resolves.toEqual({
      status: 'completed',
      agentRunId: runId,
      terraEscalationRequested: true,
      providerCallState: 'completed',
      paperOrdersCreated: 0,
      paperFillsCreated: 0,
      ledgerEntriesCreated: 0,
      replayed: false,
    })
    expect(fixture.begin).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'luna',
        routingReason: 'scheduled_candidates',
        candidateCount: 1,
        maxInputTokens: 8000,
        maxOutputTokens: 500,
        maxToolCalls: 0,
      }),
    )
    expect(fixture.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        inputTokens: 20,
        cachedInputTokens: 2,
        reasoningTokens: 1,
        output: lunaOutput,
      }),
    )
  })

  it('never calls the provider when the database quota guard skips Luna', async () => {
    const fixture = dependencies()
    fixture.begin.mockResolvedValue({
      allowed: false,
      agentRunId: runId,
      reservationId: null,
      model: 'gpt-5.6-luna',
      promptVersionId,
      systemPrompt: 'Pinned Luna prompt.',
      outputSchema: { $id: 'capital_lab_luna_decision_v1' },
      reason: 'call_limit',
      replayed: false,
    })

    await expect(
      runHostedLunaWithDependencies(input, fixture),
    ).resolves.toMatchObject({
      status: 'skipped',
      reason: 'call_limit',
      providerCallState: 'not_started',
    })
    expect(fixture.generateStructured).not.toHaveBeenCalled()
  })

  it('does not persist a relevance result for a different candidate set', async () => {
    const fixture = dependencies()
    fixture.generateStructured.mockResolvedValue({
      responseId: 'luna-response-2',
      output: {
        candidates: [
          { ...lunaOutput.candidates[0], candidateId: 'unknown-event' },
        ],
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
      latencyMs: 50,
      finishState: 'completed',
    })

    await expect(
      runHostedLunaWithDependencies(input, fixture),
    ).resolves.toMatchObject({
      status: 'failed_unknown_cost',
      reason: 'provider_candidate_set_mismatch',
    })
    expect(fixture.finalize).not.toHaveBeenCalled()
    expect(fixture.fail).toHaveBeenCalledOnce()
  })
})
