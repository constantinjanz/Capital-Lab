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
      tradingDayHardLimitUsd: '0.00035',
      monthlySoftTargetUsd: '1',
      monthlyHardLimitUsd: '1',
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
})
