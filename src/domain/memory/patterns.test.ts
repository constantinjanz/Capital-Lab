import { describe, expect, it } from 'vitest'

import { evaluatePatternPromotion } from './patterns'

const policy = {
  minimumIndependentObservations: 30,
  minimumHitRateBps: 5500,
  minimumBenchmarkRelativeReturnBps: 100,
  maximumDrawdownBps: 1200,
  requireHoldout: true,
}

describe('pattern promotion gate', () => {
  it('keeps under-evidenced patterns in shadow', () => {
    expect(
      evaluatePatternPromotion(
        {
          independentObservations: 3,
          hitRateBps: 9000,
          benchmarkRelativeReturnBps: 500,
          maximumDrawdownBps: 100,
          holdoutPassed: true,
        },
        policy,
      ),
    ).toMatchObject({
      eligible: false,
      nextStatus: 'shadow',
      reasons: ['INSUFFICIENT_INDEPENDENT_OBSERVATIONS'],
    })
  })

  it('marks a pattern eligible only after every deterministic gate passes', () => {
    expect(
      evaluatePatternPromotion(
        {
          independentObservations: 40,
          hitRateBps: 6000,
          benchmarkRelativeReturnBps: 250,
          maximumDrawdownBps: 800,
          holdoutPassed: true,
        },
        policy,
      ),
    ).toEqual({ eligible: true, nextStatus: 'eligible', reasons: [] })
  })
})
