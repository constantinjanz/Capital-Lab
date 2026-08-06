import { describe, expect, it } from 'vitest'

import { calculateCashDividend, applySplitToLots } from './corporate-actions'
import { applyFillToLots, type PositionLot } from './lots'
import type { AccountedFill, OrderSide } from './types'

function fill(input: {
  id: string
  side: OrderSide
  quantity: string
  baseNotional: string
  fees: string
  price?: string
}): AccountedFill {
  return {
    id: input.id,
    orderId: `order:${input.id}`,
    instrumentId: 'AAPL',
    side: input.side,
    quantity: input.quantity,
    price: input.price ?? '100',
    quoteNotional: input.baseNotional,
    currency: 'USD',
    fillAt: `2026-01-02T15:00:0${input.id.length}.000Z`,
    observedAt: `2026-01-02T15:00:0${input.id.length}.100Z`,
    marketDataIds: [`quote:${input.id}`],
    baseCurrency: 'EUR',
    quoteToBaseRate: '1',
    fxRateId: 'fx-1',
    baseNotional: input.baseNotional,
    commissionBase: input.fees,
    regulatoryFeeBase: '0',
    totalFeesBase: input.fees,
    idempotencyKey: `fill:${input.id}`,
  }
}

describe('FIFO lot accounting', () => {
  it('partially closes a long lot and allocates opening fees', () => {
    const opened = applyFillToLots(
      [],
      fill({
        id: 'open',
        side: 'buy',
        quantity: '10',
        baseNotional: '1000',
        fees: '2',
      }),
    )
    const closed = applyFillToLots(
      opened.lots,
      fill({
        id: 'close',
        side: 'sell',
        quantity: '4',
        baseNotional: '480',
        fees: '1',
        price: '120',
      }),
    )
    expect(closed.realizedGrossBase).toBe('80')
    expect(closed.realizedNetBase).toBe('78.2')
    expect(closed.lots[0]).toMatchObject({
      remainingQuantity: '6',
      remainingOpenBaseNotional: '600',
      openingFeeRemainingBase: '1.2',
    })
  })

  it('computes short cover P&L without treating proceeds as profit', () => {
    const opened = applyFillToLots(
      [],
      fill({
        id: 'short',
        side: 'sell_short',
        quantity: '10',
        baseNotional: '1000',
        fees: '2',
      }),
    )
    const covered = applyFillToLots(
      opened.lots,
      fill({
        id: 'cover',
        side: 'buy_to_cover',
        quantity: '5',
        baseNotional: '450',
        fees: '1',
        price: '90',
      }),
    )
    expect(covered.realizedGrossBase).toBe('50')
    expect(covered.realizedNetBase).toBe('48')
  })

  it('rejects implicit position crossing', () => {
    const short = applyFillToLots(
      [],
      fill({
        id: 'short',
        side: 'sell_short',
        quantity: '2',
        baseNotional: '200',
        fees: '0',
      }),
    )
    expect(() =>
      applyFillToLots(
        short.lots,
        fill({
          id: 'buy',
          side: 'buy',
          quantity: '1',
          baseNotional: '100',
          fees: '0',
        }),
      ),
    ).toThrow(/Position crossing/)
  })
})

describe('corporate actions', () => {
  const lots: readonly PositionLot[] = [
    {
      id: 'long-lot',
      instrumentId: 'AAPL',
      side: 'long',
      openingFillId: 'fill-long',
      openedAt: '2026-01-01T15:00:00.000Z',
      remainingQuantity: '5',
      openPrice: '100',
      remainingOpenBaseNotional: '500',
      openingFeeRemainingBase: '1',
    },
    {
      id: 'short-lot',
      instrumentId: 'AAPL',
      side: 'short',
      openingFillId: 'fill-short',
      openedAt: '2026-01-01T15:01:00.000Z',
      remainingQuantity: '2',
      openPrice: '100',
      remainingOpenBaseNotional: '200',
      openingFeeRemainingBase: '1',
    },
  ]

  it('adjusts both long and short quantities while preserving basis', () => {
    const result = applySplitToLots({
      lots,
      instrumentId: 'AAPL',
      ratio: '1.5',
      quantityIncrement: '1',
    })
    expect(result.lots.map((lot) => lot.remainingQuantity)).toEqual(['7', '3'])
    expect(result.remainders).toEqual([
      { lotId: 'long-lot', side: 'long', quantity: '0.5' },
    ])
    expect(result.lots[0]?.remainingOpenBaseNotional).toBe('500')
  })

  it('credits long dividends and charges short dividend equivalents', () => {
    const result = calculateCashDividend({
      lots,
      instrumentId: 'AAPL',
      amountPerShare: '2',
      quoteToBaseRate: '0.9',
      baseCurrencyScale: 2,
    })
    expect(result.totalBaseAmount).toBe('5.4')
    expect(result.entitlements.map((item) => item.baseAmount)).toEqual([
      '9',
      '-3.6',
    ])
  })
})
