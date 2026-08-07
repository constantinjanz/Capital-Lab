import { describe, expect, it } from 'vitest'

import { decimal, decimalValue } from '../financial/decimal'

import {
  computeDeterministicMarketFeatures,
  MARKET_FEATURE_VERSION,
  type MarketFeatureBarInput,
} from './features'

function bars(count: number): MarketFeatureBarInput[] {
  return Array.from({ length: count }, (_, index) => {
    const startsAt = new Date(Date.UTC(2026, 7, 7, 12, index)).toISOString()
    const close = decimalValue(decimal('100').plus(index.toString()))
    return {
      startsAt,
      endsAt: new Date(Date.parse(startsAt) + 60_000).toISOString(),
      open: close,
      high: close,
      low: close,
      close,
      volume: decimalValue(
        decimal('1000').plus(decimal(index.toString()).mul('10')),
      ),
    }
  })
}

describe('computeDeterministicMarketFeatures', () => {
  it('computes versioned exact-string features without JavaScript financial numbers', () => {
    const result = computeDeterministicMarketFeatures({
      quote: { bid: '109.5', ask: '110.5' },
      bars: bars(21),
    })

    expect(result).toEqual({
      version: MARKET_FEATURE_VERSION,
      observedBarCount: 21,
      contiguousBarCount: 21,
      spreadAbsolute: '1',
      spreadBps: '90.909090909091',
      return1m: '0.008403361345',
      return5m: '0.04347826087',
      relativeVolume20: '1.095890410959',
      realizedVolatility5m: '0.019115881796',
      distanceFromSma5: '0.016949152542',
      distanceFromTypicalPriceVwap20: '0.083023645199',
    })
    for (const [name, value] of Object.entries(result)) {
      if (name.endsWith('Count') || name === 'version' || value === null)
        continue
      expect(typeof value).toBe('string')
    }
  })

  it('returns unavailable values when history is insufficient or a quote side is missing', () => {
    const result = computeDeterministicMarketFeatures({
      quote: { bid: '100', ask: null },
      bars: bars(1),
    })

    expect(result).toMatchObject({
      observedBarCount: 1,
      contiguousBarCount: 1,
      spreadAbsolute: null,
      spreadBps: null,
      return1m: null,
      return5m: null,
      relativeVolume20: null,
      realizedVolatility5m: null,
      distanceFromSma5: null,
      distanceFromTypicalPriceVwap20: null,
    })
  })

  it('uses only the contiguous suffix and never bridges a missing minute', () => {
    const input = bars(8)
    const shifted = input.slice(6).map((bar) => ({
      ...bar,
      startsAt: new Date(Date.parse(bar.startsAt) + 60_000).toISOString(),
      endsAt: new Date(Date.parse(bar.endsAt) + 60_000).toISOString(),
    }))
    const result = computeDeterministicMarketFeatures({
      quote: { bid: '100', ask: '101' },
      bars: [...input.slice(0, 6), ...shifted],
    })

    expect(result.observedBarCount).toBe(8)
    expect(result.contiguousBarCount).toBe(2)
    expect(result.return1m).toBe('0.009433962264')
    expect(result.return5m).toBeNull()
    expect(result.distanceFromSma5).toBeNull()
  })

  it('fails closed for crossed quotes, duplicate bars, and invalid one-minute windows', () => {
    expect(() =>
      computeDeterministicMarketFeatures({
        quote: { bid: '101', ask: '100' },
        bars: [],
      }),
    ).toThrow('crossed quote')

    const one = bars(1)[0]!
    expect(() =>
      computeDeterministicMarketFeatures({
        quote: { bid: null, ask: null },
        bars: [one, one],
      }),
    ).toThrow('unique start timestamps')
    expect(() =>
      computeDeterministicMarketFeatures({
        quote: { bid: null, ask: null },
        bars: [
          one,
          {
            ...one,
            startsAt: '2026-08-07T14:00:00+02:00',
            endsAt: '2026-08-07T14:01:00+02:00',
          },
        ],
      }),
    ).toThrow('unique start timestamps')
    expect(() =>
      computeDeterministicMarketFeatures({
        quote: { bid: null, ask: null },
        bars: [{ ...one, endsAt: one.startsAt }],
      }),
    ).toThrow('completed one-minute bars')
  })

  it('does not divide by zero for zero midpoint, prior close, volume, or averages', () => {
    const zeroBars = bars(21).map((bar) => ({
      ...bar,
      open: '0',
      high: '0',
      low: '0',
      close: '0',
      volume: '0',
    }))
    const result = computeDeterministicMarketFeatures({
      quote: { bid: '0', ask: '0' },
      bars: zeroBars,
    })

    expect(result.spreadAbsolute).toBe('0')
    expect(result.spreadBps).toBeNull()
    expect(result.return1m).toBeNull()
    expect(result.return5m).toBeNull()
    expect(result.relativeVolume20).toBeNull()
    expect(result.realizedVolatility5m).toBeNull()
    expect(result.distanceFromSma5).toBeNull()
    expect(result.distanceFromTypicalPriceVwap20).toBeNull()
  })
})
