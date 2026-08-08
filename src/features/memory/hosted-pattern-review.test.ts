import { describe, expect, it } from 'vitest'

import {
  mapHostedPatternReviewResult,
  parseHostedPatternReviewForm,
} from './hosted-pattern-review'

const operationId = '10000000-0000-4000-8000-000000000001'
const patternId = '20000000-0000-4000-8000-000000000001'

function form(
  expectedStatus: string,
  action: string,
  fields: Record<string, string> = {},
): FormData {
  const result = new FormData()
  result.set('operationId', operationId)
  result.set('patternId', patternId)
  result.set('expectedStatus', expectedStatus)
  result.set('action', action)
  for (const [key, value] of Object.entries(fields)) result.set(key, value)
  return result
}

function resultRow(overrides: Record<string, unknown> = {}) {
  return {
    pattern_id: patternId,
    lifecycle_status: 'eligible',
    reviewed_at: '2026-08-08T12:00:00.000Z',
    independent_observations_text: '30',
    hit_rate_text: '0.60000000000000000000',
    mean_benchmark_relative_return_text: '0.01400000000000000000',
    worst_maximum_adverse_excursion_text: '-0.080000000000',
    holdout_passed: true,
    gate_eligible: true,
    gate_reasons: [],
    policy_version: 'hosted-pattern-promotion-v1',
    replayed: false,
    ...overrides,
  }
}

describe('hosted pattern review boundary mapping', () => {
  it('accepts the exact eligible review and normalizes no financial value to a number', () => {
    expect(
      parseHostedPatternReviewForm(
        form('shadow', 'mark_eligible', {
          confirmation: 'MARK PATTERN ELIGIBLE',
        }),
      ),
    ).toMatchObject({
      success: true,
      data: {
        operationId,
        patternId,
        expectedStatus: 'shadow',
        action: 'mark_eligible',
        reason: null,
      },
    })

    expect(mapHostedPatternReviewResult([resultRow()], patternId)).toEqual({
      patternId,
      lifecycleStatus: 'eligible',
      reviewedAt: '2026-08-08T12:00:00.000Z',
      independentObservations: '30',
      hitRate: '0.6',
      meanBenchmarkRelativeReturn: '0.014',
      worstMaximumAdverseExcursion: '-0.08',
      holdoutPassed: true,
      gateEligible: true,
      gateReasons: [],
      policyVersion: 'hosted-pattern-promotion-v1',
      replayed: false,
    })
  })

  it('requires the action-specific exact confirmation and bounded owner reason', () => {
    const missingConfirmation = parseHostedPatternReviewForm(
      form('shadow', 'mark_eligible', { confirmation: 'yes' }),
    )
    expect(missingConfirmation.success).toBe(false)
    if (!missingConfirmation.success) {
      expect(missingConfirmation.state.fieldErrors?.confirmation).toContain(
        'MARK PATTERN ELIGIBLE',
      )
    }

    const missingReason = parseHostedPatternReviewForm(
      form('eligible', 'retire', { confirmation: 'RETIRE PATTERN' }),
    )
    expect(missingReason.success).toBe(false)
    if (!missingReason.success) {
      expect(missingReason.state.fieldErrors?.reason).toContain('at least 3')
    }
  })

  it('rejects an action that cannot follow the expected status', () => {
    const parsed = parseHostedPatternReviewForm(
      form('eligible', 'mark_eligible', {
        confirmation: 'MARK PATTERN ELIGIBLE',
      }),
    )
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.state.fieldErrors?.action).toContain('not valid')
    }
  })

  it.each([
    [[], 'zero result rows'],
    [[resultRow(), resultRow()], 'multiple result rows'],
    [[resultRow({ pattern_id: operationId })], 'wrong pattern'],
    [[resultRow({ hit_rate_text: 0.6 })], 'numeric financial coercion'],
    [
      [
        resultRow({
          gate_eligible: true,
          gate_reasons: ['HOLDOUT_NOT_PASSED'],
        }),
      ],
      'inconsistent gate result',
    ],
    [
      [resultRow({ gate_eligible: false, gate_reasons: ['UNKNOWN_REASON'] })],
      'unknown gate reason',
    ],
  ])('maps %s to an unconfirmed result (%s)', (value) => {
    expect(mapHostedPatternReviewResult(value, patternId)).toBeNull()
  })

  it('confirms the lifecycle returned for the requested action', () => {
    expect(
      mapHostedPatternReviewResult([resultRow()], patternId, 'retire'),
    ).toBeNull()
  })
})
