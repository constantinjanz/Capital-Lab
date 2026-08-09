import { describe, expect, it } from 'vitest'

import { tradeProposalSchema, validateProposalSemantics } from './schemas'

const proposal = {
  decisionType: 'hold' as const,
  eventIds: ['event-1'],
  evidenceIds: ['evidence-1'],
  thesis: 'The reviewed evidence does not justify changing exposure.',
  scenarios: {
    bull: { summary: 'Upside evidence strengthens.', probabilityPercent: 25 },
    base: { summary: 'The signal remains mixed.', probabilityPercent: 50 },
    bear: { summary: 'Downside evidence strengthens.', probabilityPercent: 25 },
  },
  confidencePercent: 50,
  expectedDirection: 'uncertain' as const,
  expectedReturnRangeBps: { minimum: '-12.5', maximum: '8.25' },
  intendedHorizon: '1_trading_day' as const,
  invalidationConditions: ['New point-in-time evidence changes the signal.'],
  urgency: 'normal' as const,
  escalationRequested: false,
}

describe('tradeProposalSchema', () => {
  it('keeps return ranges as exact canonical decimal strings', () => {
    expect(
      validateProposalSemantics(tradeProposalSchema.parse(proposal)),
    ).toEqual(proposal)
  })

  it('rejects financial JavaScript numbers and inverted ranges', () => {
    expect(() =>
      tradeProposalSchema.parse({
        ...proposal,
        expectedReturnRangeBps: { minimum: -12.5, maximum: 8.25 },
      }),
    ).toThrow()

    expect(() =>
      validateProposalSemantics(
        tradeProposalSchema.parse({
          ...proposal,
          expectedReturnRangeBps: { minimum: '8.25', maximum: '-12.5' },
        }),
      ),
    ).toThrow('Expected return range is inverted')
  })
})
