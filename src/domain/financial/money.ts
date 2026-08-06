import {
  decimal,
  decimalValue,
  requirePositive,
  roundToScale,
  type DecimalValue,
  type RoundingDirection,
} from './decimal'

export interface Money {
  readonly currency: string
  readonly amount: DecimalValue
}

export interface FxConversion {
  readonly quoteCurrency: string
  readonly baseCurrency: string
  readonly quoteAmount: DecimalValue
  readonly quoteToBaseRate: DecimalValue
  readonly baseAmount: DecimalValue
  readonly fxRateId: string
}

export function convertQuoteToBase(input: {
  quoteCurrency: string
  baseCurrency: string
  quoteAmount: DecimalValue
  quoteToBaseRate: DecimalValue
  fxRateId: string
  baseCurrencyScale: number
  rounding?: RoundingDirection
}): FxConversion {
  const rate = requirePositive(input.quoteToBaseRate, 'quoteToBaseRate')
  const baseAmount = roundToScale(
    decimal(input.quoteAmount).mul(rate),
    input.baseCurrencyScale,
    input.rounding ?? 'nearest',
  )
  return {
    quoteCurrency: input.quoteCurrency,
    baseCurrency: input.baseCurrency,
    quoteAmount: decimalValue(decimal(input.quoteAmount)),
    quoteToBaseRate: decimalValue(rate),
    baseAmount: decimalValue(baseAmount),
    fxRateId: input.fxRateId,
  }
}
