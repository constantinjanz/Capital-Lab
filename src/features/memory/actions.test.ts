import { beforeEach, describe, expect, it, vi } from 'vitest'

import { initialHostedPatternReviewActionState } from './hosted-pattern-review'

const mocks = vi.hoisted(() => ({
  getContext: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`)
  }),
  revalidatePath: vi.fn(),
  signOut: vi.fn(),
  writeReview: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@/lib/auth/hosted-owner-mutation', () => ({
  getHostedOwnerMutationContext: mocks.getContext,
}))
vi.mock('@/lib/supabase/pattern-lifecycle-write-repository', () => ({
  writeHostedPatternLifecycleReview: mocks.writeReview,
}))

import { reviewHostedPatternLifecycle } from './actions'

const operationId = '10000000-0000-4000-8000-000000000001'
const patternId = '20000000-0000-4000-8000-000000000001'

function form() {
  const result = new FormData()
  result.set('operationId', operationId)
  result.set('patternId', patternId)
  result.set('expectedStatus', 'shadow')
  result.set('action', 'mark_eligible')
  result.set('confirmation', 'MARK PATTERN ELIGIBLE')
  return result
}

function readyContext() {
  return {
    status: 'ready' as const,
    ownerId: '00000000-0000-4000-8000-000000000001',
    supabase: { auth: { signOut: mocks.signOut } },
  }
}

function successfulResult(replayed = false) {
  return {
    ok: true,
    result: {
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
      replayed,
    },
  }
}

describe('reviewHostedPatternLifecycle action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getContext.mockResolvedValue(readyContext())
    mocks.writeReview.mockResolvedValue(successfulResult())
  })

  it('fails closed when hosted owner auth is not configured', async () => {
    mocks.getContext.mockResolvedValue({ status: 'unconfigured' })

    await expect(
      reviewHostedPatternLifecycle(
        initialHostedPatternReviewActionState,
        form(),
      ),
    ).resolves.toEqual({
      status: 'error',
      message: 'Hosted pattern review is unavailable in local mock mode.',
    })
    expect(mocks.writeReview).not.toHaveBeenCalled()
  })

  it.each([
    ['unauthenticated', '/login?reason=session-expired'],
    ['unauthorized', '/login?reason=unauthorized'],
  ] as const)(
    're-authorizes and redirects a %s caller',
    async (status, path) => {
      mocks.getContext.mockResolvedValue({
        status,
        supabase: { auth: { signOut: mocks.signOut } },
      })

      await expect(
        reviewHostedPatternLifecycle(
          initialHostedPatternReviewActionState,
          form(),
        ),
      ).rejects.toThrow(`NEXT_REDIRECT:${path}`)
      expect(mocks.writeReview).not.toHaveBeenCalled()
      expect(mocks.signOut).toHaveBeenCalledTimes(
        status === 'unauthorized' ? 1 : 0,
      )
    },
  )

  it('rejects invalid or stale form state before the database call', async () => {
    const data = form()
    data.set('expectedStatus', 'eligible')

    await expect(
      reviewHostedPatternLifecycle(initialHostedPatternReviewActionState, data),
    ).resolves.toMatchObject({
      status: 'error',
      fieldErrors: { action: expect.any(String) },
    })
    expect(mocks.writeReview).not.toHaveBeenCalled()
  })

  it('ignores forged ownership, allocation, agent, order, and fill fields', async () => {
    const data = form()
    data.set('ownerId', '00000000-0000-4000-8000-000000000999')
    data.set('allocationFraction', '1')
    data.set('runAgent', 'true')
    data.set('createOrder', 'true')
    data.set('createFill', 'true')

    await reviewHostedPatternLifecycle(
      initialHostedPatternReviewActionState,
      data,
    )

    expect(mocks.writeReview).toHaveBeenCalledWith(readyContext().supabase, {
      operationId,
      patternId,
      expectedStatus: 'shadow',
      action: 'mark_eligible',
      confirmation: 'MARK PATTERN ELIGIBLE',
      reason: null,
    })
  })

  it.each([false, true])(
    'returns a safe success result for replayed=%s',
    async (replayed) => {
      mocks.writeReview.mockResolvedValue(successfulResult(replayed))

      await expect(
        reviewHostedPatternLifecycle(
          initialHostedPatternReviewActionState,
          form(),
        ),
      ).resolves.toMatchObject({
        status: 'success',
        message: expect.stringContaining(
          replayed ? 'already recorded' : 'No assignment',
        ),
      })
      expect(mocks.revalidatePath).toHaveBeenCalledWith('/memory')
    },
  )

  it.each([
    [{ ok: false, reason: 'rejected' }, 'error'],
    [{ ok: false, reason: 'unknown' }, 'unknown'],
  ] as const)('fails closed for %s', async (result, status) => {
    mocks.writeReview.mockResolvedValue(result)
    await expect(
      reviewHostedPatternLifecycle(
        initialHostedPatternReviewActionState,
        form(),
      ),
    ).resolves.toMatchObject({ status })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
})
