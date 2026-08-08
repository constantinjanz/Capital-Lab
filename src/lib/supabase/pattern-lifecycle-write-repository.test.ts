import { describe, expect, it, vi } from 'vitest'

import type { HostedPatternReviewInput } from '@/features/memory/hosted-pattern-review'

import { writeHostedPatternLifecycleReview } from './pattern-lifecycle-write-repository'

const operationId = '10000000-0000-4000-8000-000000000001'
const patternId = '20000000-0000-4000-8000-000000000001'
const input: HostedPatternReviewInput = {
  operationId,
  patternId,
  expectedStatus: 'shadow',
  action: 'mark_eligible',
  confirmation: 'MARK PATTERN ELIGIBLE',
  reason: null,
}

function resultRow() {
  return {
    pattern_id: patternId,
    lifecycle_status: 'eligible',
    reviewed_at: '2026-08-08T12:00:00.000Z',
    independent_observations_text: '30',
    hit_rate_text: '0.6',
    mean_benchmark_relative_return_text: '0.014',
    worst_maximum_adverse_excursion_text: '-0.08',
    holdout_passed: true,
    gate_eligible: true,
    gate_reasons: [],
    policy_version: 'hosted-pattern-promotion-v1',
    replayed: false,
  }
}

describe('hosted pattern lifecycle write repository', () => {
  it('calls only the reviewed lifecycle RPC and confirms the mapped result', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [resultRow()], error: null })

    await expect(
      writeHostedPatternLifecycleReview({ rpc } as never, input),
    ).resolves.toMatchObject({
      ok: true,
      result: { patternId, lifecycleStatus: 'eligible', replayed: false },
    })
    expect(rpc).toHaveBeenCalledWith('review_hosted_pattern_lifecycle', {
      p_action: 'mark_eligible',
      p_confirmation: 'MARK PATTERN ELIGIBLE',
      p_expected_status: 'shadow',
      p_operation_id: operationId,
      p_pattern_id: patternId,
    })
  })

  it.each(['22023', '23505', '23514', '40001', '42501', '55000'])(
    'maps definite SQL rejection %s without exposing database detail',
    async (code) => {
      const rpc = vi.fn().mockResolvedValue({
        data: null,
        error: { code, message: 'sensitive database detail' },
      })
      await expect(
        writeHostedPatternLifecycleReview({ rpc } as never, input),
      ).resolves.toEqual({ ok: false, reason: 'rejected' })
    },
  )

  it.each([
    { data: null, error: { code: 'PGRST000' } },
    { data: [], error: null },
    { data: [resultRow(), resultRow()], error: null },
    { data: [{ ...resultRow(), hit_rate_text: 0.6 }], error: null },
  ])('maps an unconfirmed result to unknown', async (response) => {
    const rpc = vi.fn().mockResolvedValue(response)
    await expect(
      writeHostedPatternLifecycleReview({ rpc } as never, input),
    ).resolves.toEqual({ ok: false, reason: 'unknown' })
  })
})
