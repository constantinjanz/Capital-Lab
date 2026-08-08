import { describe, expect, it } from 'vitest'

import { InMemoryBudgetGuard } from '@/domain/budgets/guard'
import { FakeOpenAIGateway } from '@/providers/openai/fake'

import {
  AgentOrchestrator,
  type AgentRoutingConfiguration,
} from './orchestrator'

const fakeGateway = new FakeOpenAIGateway({
  luna_relevance: {
    candidates: [
      {
        candidateId: 'event-1',
        relevant: false,
        materialityScore: 10,
        noveltyScore: 20,
        urgency: 'low',
        linkedSymbols: ['SPY'],
        eventCategory: 'irrelevant_fixture',
        expectedHorizon: 'end_of_day',
        reasonSummary: 'Synthetic event is immaterial.',
        escalateToTerra: false,
      },
    ],
  },
  web_research: {
    summary: 'A cited factual update.',
    citations: [
      { title: 'Primary source', url: 'https://example.com/primary' },
    ],
  },
})

const configuration: AgentRoutingConfiguration = {
  agentEnabled: true,
  executionMode: 'shadow',
  livePaperSimulationEnabled: false,
  solEnabled: false,
  webSearchEnabled: false,
  terraDailyCap: 2,
  solDailyCap: 1,
  webDailyCap: 2,
  webMonthlyCap: 25,
}

describe('AgentOrchestrator', () => {
  it('enforces one Luna call per slot', async () => {
    const orchestrator = new AgentOrchestrator(
      fakeGateway,
      new InMemoryBudgetGuard(),
      configuration,
    )
    const request = {
      runId: 'run-1',
      tradingDay: '2026-08-06',
      decisionAt: '2026-08-06T14:00:00.000Z',
      slotKey: 'slot-1',
      regularSessionEligible: true,
      candidateCount: 1,
      compactCandidates: [{ id: 'event-1' }],
    }
    expect(await orchestrator.runLuna(request)).toMatchObject({
      status: 'completed',
    })
    expect(await orchestrator.runLuna({ ...request, runId: 'run-2' })).toEqual({
      status: 'quota_skipped',
      reason: 'luna_slot_already_used',
    })
  })

  it('keeps Sol disabled even when Terra requests escalation', async () => {
    const orchestrator = new AgentOrchestrator(
      fakeGateway,
      new InMemoryBudgetGuard(),
      configuration,
    )
    expect(
      await orchestrator.runSol({
        runId: 'run-sol',
        tradingDay: '2026-08-06',
        decisionAt: '2026-08-06T14:00:00.000Z',
        exceptionalContext: {},
        terraRequestedEscalation: true,
        exceptionalReason: 'multi_source_conflict',
      }),
    ).toEqual({ status: 'disabled', reason: 'sol_disabled' })
  })

  it('deduplicates an identical paid run before routing or reservation', async () => {
    const orchestrator = new AgentOrchestrator(
      fakeGateway,
      new InMemoryBudgetGuard(),
      configuration,
    )
    const request = {
      runId: 'run-deduplicated',
      tradingDay: '2026-08-06',
      decisionAt: '2026-08-06T14:00:00.000Z',
      slotKey: 'slot-deduplicated',
      regularSessionEligible: true,
      candidateCount: 1,
      compactCandidates: [{ id: 'event-1' }],
    }
    const [first, duplicate] = await Promise.all([
      orchestrator.runLuna(request),
      orchestrator.runLuna(request),
    ])
    expect(duplicate).toEqual(first)
  })

  it('uses a separate reservation for controlled web research', async () => {
    const budget = new InMemoryBudgetGuard()
    const orchestrator = new AgentOrchestrator(fakeGateway, budget, {
      ...configuration,
      webSearchEnabled: true,
    })
    await expect(
      orchestrator.runControlledWebResearch({
        runId: 'run-web',
        tradingDay: '2026-08-06',
        decisionAt: '2026-08-06T14:00:00.000Z',
        requestingRole: 'terra',
        query: 'What changed in the cited primary source?',
        relevantCandidate: true,
        structuredSourcesChecked: true,
        structuredSourceGap: true,
        allowedDomains: ['example.com'],
      }),
    ).resolves.toMatchObject({
      status: 'completed',
      model: 'gpt-5.6-terra',
      output: {
        summary: 'A cited factual update.',
        citations: [
          { title: 'Primary source', url: 'https://example.com/primary' },
        ],
      },
    })
    expect(
      budget.snapshot('2026-08-06T14:00:00.000Z').reservations,
    ).toHaveLength(1)
  })
})
