import {
  decimal,
  decimalValue,
  requirePositive,
  roundToIncrement,
  roundToScale,
  type DecimalValue,
} from '../financial/decimal'
import type { SimulationOrder } from './types'
import type { PositionLot, PositionSide } from './lots'

export interface SplitRemainder {
  readonly lotId: string
  readonly side: PositionSide
  readonly quantity: DecimalValue
}

export interface SplitResult {
  readonly lots: readonly PositionLot[]
  readonly remainders: readonly SplitRemainder[]
}

export function applySplitToLots(input: {
  lots: readonly PositionLot[]
  instrumentId: string
  ratio: DecimalValue
  quantityIncrement: DecimalValue
}): SplitResult {
  const ratio = requirePositive(input.ratio, 'split ratio')
  const remainders: SplitRemainder[] = []
  const lots = input.lots.map((lot): PositionLot => {
    if (
      lot.instrumentId !== input.instrumentId ||
      decimal(lot.remainingQuantity).isZero()
    )
      return lot
    const exactQuantity = decimal(lot.remainingQuantity).mul(ratio)
    const adjustedQuantity = roundToIncrement(
      exactQuantity,
      input.quantityIncrement,
      'down',
    )
    const remainder = exactQuantity.minus(adjustedQuantity)
    if (remainder.gt(0)) {
      remainders.push({
        lotId: lot.id,
        side: lot.side,
        quantity: decimalValue(remainder),
      })
    }
    return {
      ...lot,
      remainingQuantity: decimalValue(adjustedQuantity),
      openPrice: decimalValue(decimal(lot.openPrice).div(ratio)),
    }
  })
  return { lots, remainders }
}

export function applySplitToOpenOrder(input: {
  order: SimulationOrder
  ratio: DecimalValue
  quantityIncrement: DecimalValue
  priceTick: DecimalValue
}): SimulationOrder {
  const ratio = requirePositive(input.ratio, 'split ratio')
  const remaining = decimal(input.order.quantity).minus(
    decimal(input.order.filledQuantity),
  )
  const adjustedRemaining = roundToIncrement(
    remaining.mul(ratio),
    input.quantityIncrement,
    'down',
  )
  const quantity = decimal(input.order.filledQuantity).plus(adjustedRemaining)
  const adjustPrice = (
    price: DecimalValue | undefined,
  ): DecimalValue | undefined =>
    price === undefined
      ? undefined
      : decimalValue(
          roundToIncrement(
            decimal(price).div(ratio),
            input.priceTick,
            'nearest',
          ),
        )
  const limitPrice = adjustPrice(input.order.limitPrice)
  const stopPrice = adjustPrice(input.order.stopPrice)
  return {
    ...input.order,
    quantity: decimalValue(quantity),
    ...(limitPrice === undefined ? {} : { limitPrice }),
    ...(stopPrice === undefined ? {} : { stopPrice }),
  }
}

export interface DividendEntitlement {
  readonly lotId: string
  readonly side: PositionSide
  readonly quantity: DecimalValue
  readonly quoteAmount: DecimalValue
  readonly baseAmount: DecimalValue
}

export function calculateCashDividend(input: {
  lots: readonly PositionLot[]
  instrumentId: string
  amountPerShare: DecimalValue
  quoteToBaseRate: DecimalValue
  baseCurrencyScale: number
}): {
  readonly entitlements: readonly DividendEntitlement[]
  readonly totalBaseAmount: DecimalValue
} {
  const amountPerShare = requirePositive(input.amountPerShare, 'amountPerShare')
  const fx = requirePositive(input.quoteToBaseRate, 'quoteToBaseRate')
  let total = decimal('0')
  const entitlements = input.lots
    .filter(
      (lot) =>
        lot.instrumentId === input.instrumentId &&
        decimal(lot.remainingQuantity).gt(0),
    )
    .map((lot): DividendEntitlement => {
      const quoteAmount = decimal(lot.remainingQuantity).mul(amountPerShare)
      const signedQuote =
        lot.side === 'long' ? quoteAmount : quoteAmount.negated()
      const baseAmount = roundToScale(
        signedQuote.mul(fx),
        input.baseCurrencyScale,
        'nearest',
      )
      total = total.plus(baseAmount)
      return {
        lotId: lot.id,
        side: lot.side,
        quantity: lot.remainingQuantity,
        quoteAmount: decimalValue(signedQuote),
        baseAmount: decimalValue(baseAmount),
      }
    })
  return { entitlements, totalBaseAmount: decimalValue(total) }
}
