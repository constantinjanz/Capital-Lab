import { describe, expect, it } from 'vitest'

import type { MarketBar, MarketQuote } from '../market-data/types'
import { calculateIncrementalFees } from './fees'
import {
  evaluateBarFill,
  evaluateQuoteFill,
  type FillModelConfig,
} from './fill-engine'
import type { SimulationOrder } from './types'

const config: FillModelConfig = {
  slippageBps: '10',
  priceTick: '0.01',
  quantityIncrement: '1',
  allowPartialFills: false,
  participationRate: '0.1',
  staleAfterMs: 300000,
}

function order(overrides: Partial<SimulationOrder> = {}): SimulationOrder {
  return {
    id: 'order-1',
    experimentId: 'experiment-1',
    instrumentId: 'AAPL',
    currency: 'USD',
    side: 'buy',
    type: 'market',
    timeInForce: 'day',
    status: 'active',
    quantity: '10',
    filledQuantity: '0',
    decisionAt: '2026-01-02T15:00:00.000Z',
    submittedAt: '2026-01-02T15:00:00.100Z',
    acceptedAt: '2026-01-02T15:00:00.200Z',
    eligibleAt: '2026-01-02T15:00:00.600Z',
    reduceOnly: false,
    idempotencyKey: 'order-key-1',
    simulatorConfigVersionId: 'sim-v1',
    riskConfigVersionId: 'risk-v1',
    ...overrides,
  }
}

function quote(overrides: Partial<MarketQuote> = {}): MarketQuote {
  return {
    kind: 'quote',
    id: 'quote-1',
    sourceId: 'source-quote-1',
    logicalId: 'AAPL:quote:1',
    revision: 1,
    providerEventAt: '2026-01-02T15:00:01.000Z',
    firstSeenAt: '2026-01-02T15:00:01.050Z',
    availableAt: '2026-01-02T15:00:01.100Z',
    ingestedAt: '2026-01-02T15:00:01.150Z',
    instrumentId: 'AAPL',
    currency: 'USD',
    bid: '99.90',
    ask: '100',
    bidSize: '100',
    askSize: '100',
    ...overrides,
  }
}

function bar(overrides: Partial<MarketBar> = {}): MarketBar {
  return {
    kind: 'bar',
    id: 'bar-1',
    sourceId: 'source-bar-1',
    logicalId: 'AAPL:bar:1',
    revision: 1,
    providerEventAt: '2026-01-02T15:02:00.000Z',
    firstSeenAt: '2026-01-02T15:02:00.100Z',
    availableAt: '2026-01-02T15:02:00.200Z',
    ingestedAt: '2026-01-02T15:02:00.300Z',
    instrumentId: 'AAPL',
    currency: 'USD',
    startAt: '2026-01-02T15:01:00.000Z',
    endAt: '2026-01-02T15:02:00.000Z',
    open: '100',
    high: '105',
    low: '95',
    close: '101',
    volume: '1000',
    ...overrides,
  }
}

const context = {
  simulationAsOf: '2026-01-02T15:03:00.000Z',
  regularSessionOpen: true,
}

describe('deterministic fill engine', () => {
  it('fills market buys at or above ask with adverse slippage', () => {
    const result = evaluateQuoteFill(order(), quote(), config, context)
    expect(result.kind).toBe('fill')
    if (result.kind === 'fill') {
      expect(result.fill.price).toBe('100.1')
      expect(result.fill.quoteNotional).toBe('1001')
      expect(result.fill.marketDataIds).toEqual(['quote-1'])
    }
  })

  it('never violates a limit even when configured slippage is larger', () => {
    const result = evaluateQuoteFill(
      order({ type: 'limit', limitPrice: '100.05' }),
      quote(),
      config,
      context,
    )
    expect(result.kind === 'fill' && result.fill.price).toBe('100.05')
  })

  it('partially fills from displayed liquidity deterministically', () => {
    const result = evaluateQuoteFill(
      order({ quantity: '20' }),
      quote({ askSize: '50' }),
      { ...config, allowPartialFills: true },
      context,
    )
    expect(result.kind === 'fill' && result.fill.quantity).toBe('5')
  })

  it('persists an intrabar stop trigger without guessing same-bar execution', () => {
    const result = evaluateBarFill(
      order({ side: 'sell', type: 'stop', stopPrice: '98', reduceOnly: true }),
      bar(),
      config,
      context,
    )
    expect(result).toEqual({
      kind: 'triggered',
      triggeredAt: '2026-01-02T15:02:00.000Z',
    })
  })

  it('blocks a quote before the latency boundary', () => {
    const result = evaluateQuoteFill(
      order(),
      quote({ providerEventAt: '2026-01-02T15:00:00.599Z' }),
      config,
      context,
    )
    expect(result).toEqual({ kind: 'no_fill', reason: 'NOT_YET_ELIGIBLE' })
  })
})

describe('fee schedule', () => {
  it('charges an order minimum only once across partial fills', () => {
    const schedule = {
      commissionPerShare: '0.001',
      commissionBps: '0',
      minimumCommission: '1',
      sellRegulatoryFeeBps: '0',
      currencyScale: 2,
      rounding: 'up' as const,
    }
    const first = calculateIncrementalFees(
      {
        side: 'buy',
        cumulativeQuantityBefore: '0',
        cumulativeNotionalBefore: '0',
        fillQuantity: '10',
        fillNotional: '1000',
        commissionChargedBefore: '0',
        regulatoryFeeChargedBefore: '0',
      },
      schedule,
    )
    const second = calculateIncrementalFees(
      {
        side: 'buy',
        cumulativeQuantityBefore: '10',
        cumulativeNotionalBefore: '1000',
        fillQuantity: '10',
        fillNotional: '1000',
        commissionChargedBefore: first.commission,
        regulatoryFeeChargedBefore: first.regulatoryFee,
      },
      schedule,
    )
    expect(first.commission).toBe('1')
    expect(second.commission).toBe('0')
  })
})
