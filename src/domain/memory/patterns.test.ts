import { describe, expect, it } from 'vitest'

import {
  evaluatePatternPromotion,
  HOSTED_PATTERN_PROMOTION_POLICY_V1,
} from './patterns'

const policy = HOSTED_PATTERN_PROMOTION_POLICY_V1

describe('pattern promotion gate', () => {
  it('keeps under-evidenced patterns in shadow', () => {
    expect(
      evaluatePatternPromotion(
        {
          independentObservations: 3,
          hitRate: '0.9',
          meanBenchmarkRelativeReturn: '0.05',
          worstMaximumAdverseExcursion: '-0.01',
          holdoutPassed: true,
        },
        policy,
      ),
    ).toMatchObject({
      eligible: false,
      nextStatus: 'shadow',
      policyVersion: 'hosted-pattern-promotion-v1',
      reasons: ['INSUFFICIENT_INDEPENDENT_OBSERVATIONS'],
    })
  })

  it('marks a pattern eligible only after every deterministic gate passes', () => {
    expect(
      evaluatePatternPromotion(
        {
          independentObservations: 40,
          hitRate: '0.6',
          meanBenchmarkRelativeReturn: '0.025',
          worstMaximumAdverseExcursion: '-0.08',
          holdoutPassed: true,
        },
        policy,
      ),
    ).toEqual({
      eligible: true,
      nextStatus: 'eligible',
      policyVersion: 'hosted-pattern-promotion-v1',
      reasons: [],
    })
  })

  it('keeps exact boundary evidence eligible without number coercion', () => {
    expect(
      evaluatePatternPromotion(
        {
          independentObservations: 30,
          hitRate: '0.55',
          meanBenchmarkRelativeReturn: '0.01',
          worstMaximumAdverseExcursion: '-0.12',
          holdoutPassed: true,
        },
        policy,
      ).eligible,
    ).toBe(true)
  })

  it('reports every deterministic gate failure in stable order', () => {
    expect(
      evaluatePatternPromotion(
        {
          independentObservations: 29,
          hitRate: '0.549999999999',
          meanBenchmarkRelativeReturn: '0.009999999999',
          worstMaximumAdverseExcursion: '-0.120000000001',
          holdoutPassed: false,
        },
        policy,
      ).reasons,
    ).toEqual([
      'INSUFFICIENT_INDEPENDENT_OBSERVATIONS',
      'HIT_RATE_BELOW_THRESHOLD',
      'BENCHMARK_RELATIVE_RETURN_BELOW_THRESHOLD',
      'ADVERSE_EXCURSION_BELOW_LIMIT',
      'HOLDOUT_NOT_PASSED',
    ])
  })

  it('rejects non-string financial evidence and invalid excursion signs', () => {
    expect(() =>
      evaluatePatternPromotion(
        {
          independentObservations: 30,
          hitRate: 0.55 as never,
          meanBenchmarkRelativeReturn: '0.01',
          worstMaximumAdverseExcursion: '-0.12',
          holdoutPassed: true,
        },
        policy,
      ),
    ).toThrow('canonical decimal strings')

    expect(() =>
      evaluatePatternPromotion(
        {
          independentObservations: 30,
          hitRate: '0.55',
          meanBenchmarkRelativeReturn: '0.01',
          worstMaximumAdverseExcursion: '0.01',
          holdoutPassed: true,
        },
        policy,
      ),
    ).toThrow('must not be positive')
  })
})
