import { describe, expect, it } from 'vitest'

import {
  isVisibleAt,
  latestVisibleRevisions,
  selectFirstExecutableQuote,
} from './point-in-time'
import type { MarketQuote } from './types'

function quote(overrides: Partial<MarketQuote> = {}): MarketQuote {
  return {
    kind: 'quote',
    id: 'q1',
    sourceId: 'provider-q1',
    logicalId: 'AAPL:quote',
    revision: 1,
    providerEventAt: '2026-01-02T15:00:00.000Z',
    firstSeenAt: '2026-01-02T15:00:00.100Z',
    availableAt: '2026-01-02T15:00:00.200Z',
    ingestedAt: '2026-01-02T15:00:00.250Z',
    instrumentId: 'AAPL',
    currency: 'USD',
    bid: '99.99',
    ask: '100.01',
    bidSize: '100',
    askSize: '100',
    ...overrides,
  }
}

describe('point-in-time selection', () => {
  it('uses availability rather than publication time', () => {
    const late = quote({ availableAt: '2026-01-02T15:10:00.000Z' })
    expect(isVisibleAt(late, '2026-01-02T15:05:00.000Z')).toBe(false)
  })

  it('does not leak a later correction into an earlier decision', () => {
    const original = quote()
    const corrected = quote({
      id: 'q2',
      revision: 2,
      bid: '90',
      ask: '91',
      availableAt: '2026-01-02T15:30:00.000Z',
      revisionOf: original.id,
    })
    expect(
      latestVisibleRevisions([original, corrected], '2026-01-02T15:05:00.000Z'),
    ).toEqual([original])
    expect(
      latestVisibleRevisions([original, corrected], '2026-01-02T15:31:00.000Z'),
    ).toEqual([corrected])
  })

  it('selects the first fresh opportunity after latency', () => {
    const before = quote({
      id: 'before',
      providerEventAt: '2026-01-02T15:00:00.500Z',
    })
    const eligible = quote({
      id: 'eligible',
      logicalId: 'AAPL:quote:eligible',
      providerEventAt: '2026-01-02T15:00:00.600Z',
      firstSeenAt: '2026-01-02T15:00:00.650Z',
      availableAt: '2026-01-02T15:00:00.700Z',
    })
    expect(
      selectFirstExecutableQuote({
        quotes: [before, eligible],
        instrumentId: 'AAPL',
        eligibleAt: '2026-01-02T15:00:00.600Z',
        simulationAsOf: '2026-01-02T15:01:00.000Z',
        staleAfterMs: 5000,
      })?.id,
    ).toBe('eligible')
  })
})
