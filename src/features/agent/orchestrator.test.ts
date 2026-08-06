import { describe, expect, it } from 'vitest'

import { InMemoryBudgetGuard } from '@/domain/budgets/guard'
import { FakeOpenAIGateway } from '@/providers/openai/fake'

import { AgentOrchestrator } from './orchestrator'

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
})

describe('AgentOrchestrator', () => {
  it('enforces one Luna call per slot', async () => {
    const orchestrator = new AgentOrchestrator(
      fakeGateway,
      new InMemoryBudgetGuard(),
      { enabled: true, solEnabled: false, terraDailyCap: 2, solDailyCap: 1 },
    )
    const request = {
      runId: 'run-1',
      tradingDay: '2026-08-06',
      slotKey: 'slot-1',
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
      { enabled: true, solEnabled: false, terraDailyCap: 2, solDailyCap: 1 },
    )
    expect(
      await orchestrator.runSol({
        runId: 'run-sol',
        tradingDay: '2026-08-06',
        exceptionalContext: {},
        terraRequestedEscalation: true,
      }),
    ).toEqual({ status: 'disabled', reason: 'sol_disabled' })
  })
})
