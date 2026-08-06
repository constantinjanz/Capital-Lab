import { describe, expect, it } from 'vitest'

import type { PositionLot } from '../simulation/lots'
import { valuePortfolio } from './valuation'

describe('portfolio valuation', () => {
  it('uses bid for long liquidation and ask for short liabilities', () => {
    const lots: readonly PositionLot[] = [
      {
        id: 'long',
        instrumentId: 'LONG',
        side: 'long',
        openingFillId: 'f1',
        openedAt: '2026-01-01T00:00:00.000Z',
        remainingQuantity: '10',
        openPrice: '100',
        remainingOpenBaseNotional: '1000',
        openingFeeRemainingBase: '2',
      },
      {
        id: 'short',
        instrumentId: 'SHORT',
        side: 'short',
        openingFillId: 'f2',
        openedAt: '2026-01-01T00:00:01.000Z',
        remainingQuantity: '5',
        openPrice: '100',
        remainingOpenBaseNotional: '500',
        openingFeeRemainingBase: '1',
      },
    ]
    const result = valuePortfolio({
      cashBase: '100000',
      lots,
      marks: [
        {
          instrumentId: 'LONG',
          bid: '99',
          ask: '100',
          quoteToBaseRate: '1',
          marketDataId: 'q1',
          fxRateId: 'fx',
        },
        {
          instrumentId: 'SHORT',
          bid: '100',
          ask: '101',
          quoteToBaseRate: '1',
          marketDataId: 'q2',
          fxRateId: 'fx',
        },
      ],
    })
    expect(result.netLiquidationValue).toBe('100485')
    expect(result.unrealizedGrossPnl).toBe('-15')
    expect(result.unrealizedNetPnl).toBe('-18')
    expect(result.grossExposure).toBe('1505')
  })
})
