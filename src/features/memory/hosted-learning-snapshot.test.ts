import { describe, expect, it } from 'vitest'

import { mapHostedLearningSnapshotResult } from './hosted-learning-snapshot'

const ownerId = '00000000-0000-4000-8000-000000000001'
const experimentId = '10000000-0000-4000-8000-000000000001'
const patternId = '20000000-0000-4000-8000-000000000001'
const assignmentId = '30000000-0000-4000-8000-000000000001'
const strategyVersionId = '40000000-0000-4000-8000-000000000001'
const decisionAt = '2026-08-08T12:00:00.000Z'
const historicalAt = '2026-08-08T11:00:00.000Z'

const gateConfig = {
  policyVersion: 'hosted-pattern-promotion-v1',
  minimumIndependentObservations: 30,
  minimumHitRate: '0.55',
  minimumMeanBenchmarkRelativeReturn: '0.01',
  minimumAllowedMaximumAdverseExcursion: '-0.12',
  requireHoldout: true,
}

const eligiblePattern = {
  id: patternId,
  experiment_id: experimentId,
  name: 'Exact evidence fixture',
  hypothesis: 'Exact strings cross the hosted boundary.',
  lifecycle_status: 'shadow',
  gate_config: gateConfig,
  proposed_at: historicalAt,
  updated_at: historicalAt,
  created_at: historicalAt,
  policy_version: 'hosted-pattern-promotion-v1',
  independent_observations_text: '30',
  hit_rate_text: '0.60000000000000000000',
  mean_benchmark_relative_return_text: '0.01400000000000000000',
  worst_maximum_adverse_excursion_text: '-0.080000000000',
  holdout_passed: true,
  policy_matches: true,
  eligible: true,
  reasons: [],
}

const assignment = {
  id: assignmentId,
  experiment_id: experimentId,
  strategy_version_id: strategyVersionId,
  strategy_name: 'Paper strategy',
  strategy_version: 2,
  strategy_content_hash: 'a'.repeat(64),
  assignment_type: 'champion',
  allocation_fraction_text: '0.600000000000',
  valid_from: historicalAt,
  valid_to: null,
  promotion_evidence: { review: 'owner' },
  created_at: historicalAt,
}

function snapshot(overrides: Record<string, unknown> = {}) {
  return [
    {
      owner_id: ownerId,
      decision_at: decisionAt,
      calibration_rows: [
        {
          band_index: 3,
          band_lower_text: '0.6',
          band_upper_text: '0.8',
          decision_count_text: '31',
          evaluated_count_text: '30',
          mean_confidence_text: '0.70000000000000000000',
          observed_hit_rate_text: '0.60000000000000000000',
        },
      ],
      category_rows: [
        {
          decision_type: 'buy',
          decision_count_text: '31',
          evaluated_count_text: '30',
          mean_confidence_text: '0.70000000000000000000',
          hit_rate_text: '0.60000000000000000000',
          mean_forward_return_text: '0.01900000000000000000',
          mean_benchmark_relative_return_text: '0.01400000000000000000',
        },
      ],
      evidence_kind_rows: [
        {
          evidence_kind: 'event',
          citation_count_text: '31',
          decision_count_text: '31',
        },
      ],
      horizon_rows: [
        {
          horizon: '1d',
          outcome_count_text: '30',
          hit_rate_text: '0.60000000000000000000',
          mean_forward_return_text: '0.01900000000000000000',
          mean_benchmark_relative_return_text: '0.01400000000000000000',
          maximum_favorable_excursion_text: '0.050000000000',
          worst_maximum_adverse_excursion_text: '-0.080000000000',
        },
      ],
      pattern_rows: [eligiblePattern],
      assignment_rows: [assignment],
      ...overrides,
    },
  ]
}

describe('mapHostedLearningSnapshotResult', () => {
  it('maps one owner-scoped historical snapshot without numeric coercion', () => {
    const result = mapHostedLearningSnapshotResult(
      snapshot(),
      ownerId,
      decisionAt,
    )

    expect(result).toMatchObject({
      source: 'supabase',
      decisionAt,
      calibration: [
        {
          decisionCount: '31',
          evaluatedCount: '30',
          meanConfidence: '0.7',
          observedHitRate: '0.6',
        },
      ],
      horizons: [
        {
          outcomeCount: '30',
          meanBenchmarkRelativeReturn: '0.014',
          worstMaximumAdverseExcursion: '-0.08',
        },
      ],
      patterns: [
        {
          independentObservations: '30',
          hitRate: '0.6',
          eligible: true,
          reasons: [],
        },
      ],
      assignments: [{ allocationFraction: '0.6' }],
    })
  })

  it('accepts a mismatched fixed policy only with the exact rejection reason', () => {
    const mismatched = {
      ...eligiblePattern,
      gate_config: { ...gateConfig, minimumHitRate: '0.60' },
      policy_matches: false,
      eligible: false,
      reasons: ['POLICY_CONFIG_MISMATCH'],
    }

    expect(
      mapHostedLearningSnapshotResult(
        snapshot({ pattern_rows: [mismatched] }),
        ownerId,
        decisionAt,
      ).patterns[0],
    ).toMatchObject({ policyMatches: false, eligible: false })
  })

  it.each([
    {
      name: 'owner crossing',
      overrides: { owner_id: '00000000-0000-4000-8000-000000000099' },
    },
    {
      name: 'future lifecycle update',
      overrides: {
        pattern_rows: [
          { ...eligiblePattern, updated_at: '2026-08-08T12:00:01.000Z' },
        ],
      },
    },
    {
      name: 'inconsistent gate decision',
      overrides: {
        pattern_rows: [{ ...eligiblePattern, reasons: ['HOLDOUT_NOT_PASSED'] }],
      },
    },
    {
      name: 'excessive exact allocation',
      overrides: {
        assignment_rows: [
          assignment,
          {
            ...assignment,
            id: '30000000-0000-4000-8000-000000000002',
            assignment_type: 'challenger',
            allocation_fraction_text: '0.5',
          },
        ],
      },
    },
  ])('fails closed on $name', ({ overrides }) => {
    expect(() =>
      mapHostedLearningSnapshotResult(snapshot(overrides), ownerId, decisionAt),
    ).toThrow()
  })

  it('rejects JavaScript numbers in every financial field', () => {
    expect(() =>
      mapHostedLearningSnapshotResult(
        snapshot({
          horizon_rows: [
            {
              ...snapshot()[0].horizon_rows[0],
              mean_forward_return_text: 0.019,
            },
          ],
        }),
        ownerId,
        decisionAt,
      ),
    ).toThrow('mean forward return')
  })
})
