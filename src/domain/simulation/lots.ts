import {
  decimal,
  decimalValue,
  type DecimalValue,
  type FinancialDecimal,
} from '../financial/decimal'
import type { AccountedFill } from './types'

export type PositionSide = 'long' | 'short'

export interface PositionLot {
  readonly id: string
  readonly instrumentId: string
  readonly side: PositionSide
  readonly openingFillId: string
  readonly openedAt: string
  readonly remainingQuantity: DecimalValue
  readonly openPrice: DecimalValue
  readonly remainingOpenBaseNotional: DecimalValue
  readonly openingFeeRemainingBase: DecimalValue
}

export interface LotMatch {
  readonly lotId: string
  readonly closingFillId: string
  readonly quantity: DecimalValue
  readonly openingBaseNotional: DecimalValue
  readonly closingBaseNotional: DecimalValue
  readonly openingFeeBase: DecimalValue
  readonly closingFeeBase: DecimalValue
  readonly realizedGrossBase: DecimalValue
  readonly realizedNetBase: DecimalValue
}

export interface LotApplicationResult {
  readonly lots: readonly PositionLot[]
  readonly matches: readonly LotMatch[]
  readonly realizedGrossBase: DecimalValue
  readonly realizedNetBase: DecimalValue
}

function entrySide(fill: AccountedFill): PositionSide | undefined {
  if (fill.side === 'buy') return 'long'
  if (fill.side === 'sell_short') return 'short'
  return undefined
}

function closingSide(fill: AccountedFill): PositionSide | undefined {
  if (fill.side === 'sell') return 'long'
  if (fill.side === 'buy_to_cover') return 'short'
  return undefined
}

function proportional(
  total: FinancialDecimal,
  part: FinancialDecimal,
  whole: FinancialDecimal,
): FinancialDecimal {
  return part.eq(whole) ? total : total.mul(part).div(whole)
}

export function applyFillToLots(
  existingLots: readonly PositionLot[],
  fill: AccountedFill,
): LotApplicationResult {
  const quantity = decimal(fill.quantity)
  if (quantity.lte(0)) throw new RangeError('fill quantity must be positive')
  const openingSide = entrySide(fill)
  const oppositeSide: PositionSide = openingSide === 'long' ? 'short' : 'long'

  if (openingSide !== undefined) {
    if (
      existingLots.some(
        (lot) =>
          lot.instrumentId === fill.instrumentId &&
          lot.side === oppositeSide &&
          decimal(lot.remainingQuantity).gt(0),
      )
    ) {
      throw new Error(
        'Position crossing is not allowed; close the opposing position explicitly',
      )
    }
    const newLot: PositionLot = {
      id: `lot:${fill.id}`,
      instrumentId: fill.instrumentId,
      side: openingSide,
      openingFillId: fill.id,
      openedAt: fill.fillAt,
      remainingQuantity: fill.quantity,
      openPrice: fill.price,
      remainingOpenBaseNotional: fill.baseNotional,
      openingFeeRemainingBase: fill.totalFeesBase,
    }
    return {
      lots: [...existingLots, newLot],
      matches: [],
      realizedGrossBase: '0',
      realizedNetBase: '0',
    }
  }

  const requiredSide = closingSide(fill)
  if (requiredSide === undefined)
    throw new Error(`Unsupported fill side: ${fill.side}`)
  const matchingLots = existingLots
    .filter(
      (lot) =>
        lot.instrumentId === fill.instrumentId &&
        lot.side === requiredSide &&
        decimal(lot.remainingQuantity).gt(0),
    )
    .sort(
      (left, right) =>
        left.openedAt.localeCompare(right.openedAt) ||
        left.id.localeCompare(right.id),
    )
  const available = matchingLots.reduce(
    (sum, lot) => sum.plus(decimal(lot.remainingQuantity)),
    decimal('0'),
  )
  if (available.lt(quantity)) {
    throw new Error(`Insufficient ${requiredSide} position to close`)
  }

  let remainingToClose = quantity
  let realizedGross = decimal('0')
  let realizedNet = decimal('0')
  const matches: LotMatch[] = []
  const updates = new Map<string, PositionLot>()

  for (const lot of matchingLots) {
    if (remainingToClose.isZero()) break
    const lotQuantity = decimal(lot.remainingQuantity)
    const matchedQuantity = remainingToClose.lt(lotQuantity)
      ? remainingToClose
      : lotQuantity
    const openingNotional = proportional(
      decimal(lot.remainingOpenBaseNotional),
      matchedQuantity,
      lotQuantity,
    )
    const openingFee = proportional(
      decimal(lot.openingFeeRemainingBase),
      matchedQuantity,
      lotQuantity,
    )
    const closingNotional = proportional(
      decimal(fill.baseNotional),
      matchedQuantity,
      quantity,
    )
    const closingFee = proportional(
      decimal(fill.totalFeesBase),
      matchedQuantity,
      quantity,
    )
    const gross =
      requiredSide === 'long'
        ? closingNotional.minus(openingNotional)
        : openingNotional.minus(closingNotional)
    const net = gross.minus(openingFee).minus(closingFee)
    realizedGross = realizedGross.plus(gross)
    realizedNet = realizedNet.plus(net)
    matches.push({
      lotId: lot.id,
      closingFillId: fill.id,
      quantity: decimalValue(matchedQuantity),
      openingBaseNotional: decimalValue(openingNotional),
      closingBaseNotional: decimalValue(closingNotional),
      openingFeeBase: decimalValue(openingFee),
      closingFeeBase: decimalValue(closingFee),
      realizedGrossBase: decimalValue(gross),
      realizedNetBase: decimalValue(net),
    })
    updates.set(lot.id, {
      ...lot,
      remainingQuantity: decimalValue(lotQuantity.minus(matchedQuantity)),
      remainingOpenBaseNotional: decimalValue(
        decimal(lot.remainingOpenBaseNotional).minus(openingNotional),
      ),
      openingFeeRemainingBase: decimalValue(
        decimal(lot.openingFeeRemainingBase).minus(openingFee),
      ),
    })
    remainingToClose = remainingToClose.minus(matchedQuantity)
  }

  return {
    lots: existingLots.map((lot) => updates.get(lot.id) ?? lot),
    matches,
    realizedGrossBase: decimalValue(realizedGross),
    realizedNetBase: decimalValue(realizedNet),
  }
}

export function cashDeltaForFill(fill: AccountedFill): DecimalValue {
  const principal = decimal(fill.baseNotional)
  const fees = decimal(fill.totalFeesBase)
  const receivesPrincipal = fill.side === 'sell' || fill.side === 'sell_short'
  return decimalValue(
    receivesPrincipal ? principal.minus(fees) : principal.negated().minus(fees),
  )
}
