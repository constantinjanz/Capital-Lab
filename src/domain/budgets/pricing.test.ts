import { describe, expect, it } from 'vitest'

import {
  calculateUsageCost,
  CURRENT_MODEL_PRICING,
  resolveEffectivePricing,
} from './pricing'

describe('model pricing', () => {
  it('calculates cached, uncached, cache-write, output, and search costs exactly', () => {
    expect(
      calculateUsageCost(CURRENT_MODEL_PRICING['gpt-5.6-luna'], {
        inputTokens: '1000000',
        cachedInputTokens: '1000000',
        cacheWriteTokens: '1000000',
        outputTokens: '1000000',
        webSearchCalls: '1',
      }),
    ).toBe('1.68')
  })

  it('selects exactly one half-open effective-dated price', () => {
    const oldPrice = {
      ...CURRENT_MODEL_PRICING['gpt-5.6-luna'],
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      effectiveTo: '2026-08-06T00:00:00.000Z',
    }
    expect(
      resolveEffectivePricing(
        [oldPrice, CURRENT_MODEL_PRICING['gpt-5.6-luna']],
        'gpt-5.6-luna',
        '2026-08-06T00:00:00.000Z',
      ).effectiveFrom,
    ).toBe('2026-08-06T00:00:00.000Z')
  })

  it('rejects gaps and overlaps instead of guessing', () => {
    expect(() =>
      resolveEffectivePricing(
        [CURRENT_MODEL_PRICING['gpt-5.6-luna']],
        'gpt-5.6-luna',
        '2025-01-01T00:00:00.000Z',
      ),
    ).toThrow('No effective pricing')
    expect(() =>
      resolveEffectivePricing(
        [
          CURRENT_MODEL_PRICING['gpt-5.6-luna'],
          {
            ...CURRENT_MODEL_PRICING['gpt-5.6-luna'],
            effectiveFrom: '2026-08-06T00:00:00.000Z',
          },
        ],
        'gpt-5.6-luna',
        '2026-08-07T00:00:00.000Z',
      ),
    ).toThrow('Overlapping effective pricing')
  })
})
