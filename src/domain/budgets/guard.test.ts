import { describe, expect, it } from 'vitest'

import { InMemoryBudgetGuard } from './guard'

const usage = {
  inputTokens: '1000',
  cachedInputTokens: '0',
  cacheWriteTokens: '0',
  outputTokens: '100',
  webSearchCalls: '0',
}

describe('InMemoryBudgetGuard', () => {
  it('deduplicates concurrent reservations by idempotency key', async () => {
    const guard = new InMemoryBudgetGuard()
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        guard.reserve({
          idempotencyKey: 'agent:run-1:luna',
          model: 'gpt-5.6-luna',
          at: '2026-08-06T14:00:00.000Z',
          worstCaseUsage: usage,
        }),
      ),
    )
    expect(results.every((result) => result.accepted)).toBe(true)
    expect(
      guard.snapshot('2026-08-06T14:00:00.000Z').reservations,
    ).toHaveLength(1)
  })

  it('keeps unknown outcomes charged against hard limits', async () => {
    const guard = new InMemoryBudgetGuard({
      tradingDaySoftTargetUsd: '0.0002',
      tradingDayHardLimitUsd: '0.00035',
      monthlySoftTargetUsd: '1',
      monthlyHardLimitUsd: '1',
      experimentHardLimitUsd: '1',
      lifetimeHardLimitUsd: '1',
      timezone: 'America/New_York',
    })
    const first = await guard.reserve({
      idempotencyKey: 'one',
      model: 'gpt-5.6-luna',
      at: '2026-08-06T14:00:00.000Z',
      worstCaseUsage: usage,
    })
    expect(first.accepted).toBe(true)
    await guard.markUnknown('one')
    const second = await guard.reserve({
      idempotencyKey: 'two',
      model: 'gpt-5.6-luna',
      at: '2026-08-06T14:15:00.000Z',
      worstCaseUsage: usage,
    })
    expect(second).toMatchObject({ accepted: false, reason: 'daily_limit' })
  })

  it.each([
    ['daily', '0.40', 'daily_limit'],
    ['monthly', '10.00', 'monthly_limit'],
    ['experiment', '30.00', 'experiment_limit'],
    ['lifetime', '50.00', 'lifetime_limit'],
  ] as const)(
    'accepts exact %s hard limit and rejects the next reservation',
    async (limitKind, hardLimit, expectedReason) => {
      const oneInputToken = {
        inputTokens: '1',
        cachedInputTokens: '0',
        cacheWriteTokens: '0',
        outputTokens: '0',
        webSearchCalls: '0',
      }
      const inputTokensAtLimit = String(Number(hardLimit) * 5_000_000)
      const policy = {
        tradingDaySoftTargetUsd: '0.25' as const,
        tradingDayHardLimitUsd:
          limitKind === 'daily' ? hardLimit : ('100' as const),
        monthlySoftTargetUsd: '8.00' as const,
        monthlyHardLimitUsd:
          limitKind === 'monthly' ? hardLimit : ('100' as const),
        experimentHardLimitUsd:
          limitKind === 'experiment' ? hardLimit : ('100' as const),
        lifetimeHardLimitUsd:
          limitKind === 'lifetime' ? hardLimit : ('100' as const),
        timezone: 'America/New_York' as const,
      }
      const guard = new InMemoryBudgetGuard(policy)
      const under = await guard.reserve({
        idempotencyKey: 'under-limit',
        model: 'gpt-5.6-luna',
        at: '2026-08-09T14:00:00.000Z',
        worstCaseUsage: {
          ...oneInputToken,
          inputTokens: String(Number(inputTokensAtLimit) - 1),
        },
      })
      expect(under).toMatchObject({ accepted: true })
      const at = await guard.reserve({
        idempotencyKey: 'at-limit',
        model: 'gpt-5.6-luna',
        at: '2026-08-09T14:05:00.000Z',
        worstCaseUsage: oneInputToken,
      })
      expect(at).toMatchObject({ accepted: true })
      await expect(
        guard.reserve({
          idempotencyKey: 'over-limit',
          model: 'gpt-5.6-luna',
          at: '2026-08-09T14:15:00.000Z',
          worstCaseUsage: oneInputToken,
        }),
      ).resolves.toMatchObject({ accepted: false, reason: expectedReason })
    },
  )
})
