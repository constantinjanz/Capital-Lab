import { describe, expect, it, vi } from 'vitest'

import type { AgentRoutingPolicy } from '@/domain/agent/routing'
import { tradeProposalSchema } from '@/domain/agent/schemas'

import { dispatchTradeProposal } from './proposal-dispatch'

const proposal = tradeProposalSchema.parse({
  decisionType: 'buy',
  instrumentId: 'instrument-1',
  symbol: 'SPY',
  eventIds: ['event-1'],
  evidenceIds: ['evidence-1'],
  thesis: 'Point-in-time evidence supports a bounded paper proposal.',
  scenarios: {
    bull: { summary: 'Evidence strengthens.', probabilityPercent: 25 },
    base: { summary: 'Evidence persists.', probabilityPercent: 50 },
    bear: { summary: 'Evidence reverses.', probabilityPercent: 25 },
  },
  confidencePercent: 60,
  expectedDirection: 'up',
  expectedReturnRangeBps: { minimum: '-25', maximum: '50.5' },
  intendedHorizon: '1_trading_day',
  targetExposureFraction: '0.05',
  invalidationConditions: ['The evidence becomes unavailable or reverses.'],
  urgency: 'normal',
  preferredOrderType: 'limit',
  priceConstraint: '500.25',
  escalationRequested: false,
})

const policy: AgentRoutingPolicy = {
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

describe('dispatchTradeProposal', () => {
  it('persists a shadow decision without invoking simulation', async () => {
    const recordProposal = vi
      .fn()
      .mockResolvedValue({ decisionId: 'decision-1' })
    const evaluateProposal = vi.fn()

    await expect(
      dispatchTradeProposal(
        {
          policy,
          decisionAt: '2026-08-06T14:00:00.000Z',
          proposal,
        },
        {
          decisions: { recordProposal },
          simulation: { evaluateProposal },
        },
      ),
    ).resolves.toEqual({
      status: 'shadow',
      decisionId: 'decision-1',
      simulationOrderId: null,
    })
    expect(recordProposal).toHaveBeenCalledWith(
      expect.objectContaining({ proposalStatus: 'shadow' }),
    )
    expect(evaluateProposal).not.toHaveBeenCalled()
  })

  it('delegates explicit live-paper proposals only to simulation', async () => {
    const evaluateProposal = vi.fn().mockResolvedValue({
      accepted: true,
      simulationOrderId: 'paper-order-1',
    })
    const result = await dispatchTradeProposal(
      {
        policy: {
          ...policy,
          executionMode: 'live_paper',
          livePaperSimulationEnabled: true,
        },
        decisionAt: '2026-08-06T14:00:00.000Z',
        proposal,
      },
      {
        decisions: {
          recordProposal: vi
            .fn()
            .mockResolvedValue({ decisionId: 'decision-2' }),
        },
        simulation: { evaluateProposal },
      },
    )
    expect(result).toEqual({
      status: 'simulation_accepted',
      decisionId: 'decision-2',
      simulationOrderId: 'paper-order-1',
    })
    expect(evaluateProposal).toHaveBeenCalledOnce()
  })
})
