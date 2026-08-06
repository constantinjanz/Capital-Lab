import {
  decimal,
  decimalValue,
  requirePositive,
  type DecimalValue,
} from '../financial/decimal'
import type { PositionLot } from '../simulation/lots'

export interface PositionMark {
  readonly instrumentId: string
  readonly bid: DecimalValue
  readonly ask: DecimalValue
  readonly quoteToBaseRate: DecimalValue
  readonly marketDataId: string
  readonly fxRateId: string
}

export interface PortfolioValuation {
  readonly netLiquidationValue: DecimalValue
  readonly longMarketValue: DecimalValue
  readonly shortMarketValue: DecimalValue
  readonly grossExposure: DecimalValue
  readonly netExposure: DecimalValue
  readonly unrealizedGrossPnl: DecimalValue
  readonly unrealizedNetPnl: DecimalValue
}

export function valuePortfolio(input: {
  cashBase: DecimalValue
  lots: readonly PositionLot[]
  marks: readonly PositionMark[]
}): PortfolioValuation {
  let longValue = decimal('0')
  let shortValue = decimal('0')
  let grossExposure = decimal('0')
  let netExposure = decimal('0')
  let unrealizedGross = decimal('0')
  let unrealizedNet = decimal('0')
  const marks = new Map(input.marks.map((mark) => [mark.instrumentId, mark]))

  for (const lot of input.lots) {
    const quantity = decimal(lot.remainingQuantity)
    if (quantity.isZero()) continue
    const mark = marks.get(lot.instrumentId)
    if (mark === undefined)
      throw new Error(`Missing mark for ${lot.instrumentId}`)
    const bid = requirePositive(mark.bid, 'mark.bid')
    const ask = requirePositive(mark.ask, 'mark.ask')
    if (bid.gt(ask)) throw new Error(`Crossed market for ${lot.instrumentId}`)
    const fx = requirePositive(mark.quoteToBaseRate, 'mark.quoteToBaseRate')
    const liquidationValue = quantity
      .mul(lot.side === 'long' ? bid : ask)
      .mul(fx)
    const adverseExposure = quantity.mul(ask).mul(fx)
    const openingBasis = decimal(lot.remainingOpenBaseNotional)
    const openingFees = decimal(lot.openingFeeRemainingBase)
    const grossPnl =
      lot.side === 'long'
        ? liquidationValue.minus(openingBasis)
        : openingBasis.minus(liquidationValue)
    const netPnl = grossPnl.minus(openingFees)

    if (lot.side === 'long') longValue = longValue.plus(liquidationValue)
    else shortValue = shortValue.plus(liquidationValue)
    grossExposure = grossExposure.plus(adverseExposure)
    netExposure =
      lot.side === 'long'
        ? netExposure.plus(adverseExposure)
        : netExposure.minus(adverseExposure)
    unrealizedGross = unrealizedGross.plus(grossPnl)
    unrealizedNet = unrealizedNet.plus(netPnl)
  }

  return {
    netLiquidationValue: decimalValue(
      decimal(input.cashBase).plus(longValue).minus(shortValue),
    ),
    longMarketValue: decimalValue(longValue),
    shortMarketValue: decimalValue(shortValue),
    grossExposure: decimalValue(grossExposure),
    netExposure: decimalValue(netExposure),
    unrealizedGrossPnl: decimalValue(unrealizedGross),
    unrealizedNetPnl: decimalValue(unrealizedNet),
  }
}
