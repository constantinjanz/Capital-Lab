import {
  decimal,
  decimalValue,
  requireNonNegative,
  roundToScale,
  type DecimalValue,
  type FinancialDecimal,
} from '../financial/decimal'

export const MARKET_FEATURE_VERSION = 'market-technical-v1' as const

const ONE_MINUTE_MS = 60_000
const OUTPUT_SCALE = 12

export interface MarketFeatureQuoteInput {
  readonly bid: DecimalValue | null
  readonly ask: DecimalValue | null
}

export interface MarketFeatureBarInput {
  readonly startsAt: string
  readonly endsAt: string
  readonly open: DecimalValue
  readonly high: DecimalValue
  readonly low: DecimalValue
  readonly close: DecimalValue
  readonly volume: DecimalValue
}

export interface DeterministicMarketFeatures {
  readonly version: typeof MARKET_FEATURE_VERSION
  readonly observedBarCount: number
  readonly contiguousBarCount: number
  readonly spreadAbsolute: DecimalValue | null
  readonly spreadBps: DecimalValue | null
  readonly return1m: DecimalValue | null
  readonly return5m: DecimalValue | null
  readonly relativeVolume20: DecimalValue | null
  readonly realizedVolatility5m: DecimalValue | null
  readonly distanceFromSma5: DecimalValue | null
  readonly distanceFromTypicalPriceVwap20: DecimalValue | null
}

function instant(value: string, label: string): number {
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds)) {
    throw new TypeError(`${label} must be a valid timestamp`)
  }
  return milliseconds
}

function validateBar(bar: MarketFeatureBarInput): void {
  const startsAt = instant(bar.startsAt, 'bar start')
  const endsAt = instant(bar.endsAt, 'bar end')
  if (endsAt - startsAt !== ONE_MINUTE_MS) {
    throw new RangeError('Feature inputs must be completed one-minute bars')
  }

  const open = requireNonNegative(bar.open, 'bar open')
  const high = requireNonNegative(bar.high, 'bar high')
  const low = requireNonNegative(bar.low, 'bar low')
  const close = requireNonNegative(bar.close, 'bar close')
  requireNonNegative(bar.volume, 'bar volume')
  if (
    high.lt(open) ||
    high.lt(low) ||
    high.lt(close) ||
    low.gt(open) ||
    low.gt(high) ||
    low.gt(close)
  ) {
    throw new RangeError('Feature input has an invalid OHLC bar')
  }
}

function sortedUniqueBars(
  bars: readonly MarketFeatureBarInput[],
): MarketFeatureBarInput[] {
  if (bars.length > 21) {
    throw new RangeError('At most 21 feature bars are allowed')
  }
  const sorted = [...bars].sort(
    (left, right) =>
      instant(left.startsAt, 'bar start') -
      instant(right.startsAt, 'bar start'),
  )
  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index]!
    validateBar(current)
    const previous = sorted[index - 1]
    if (
      previous &&
      instant(previous.startsAt, 'bar start') ===
        instant(current.startsAt, 'bar start')
    ) {
      throw new RangeError('Feature bars must have unique start timestamps')
    }
  }
  return sorted
}

function contiguousSuffix(
  sorted: readonly MarketFeatureBarInput[],
): readonly MarketFeatureBarInput[] {
  if (sorted.length < 2) return sorted
  let start = sorted.length - 1
  while (start > 0) {
    const previousStart = instant(sorted[start - 1]!.startsAt, 'bar start')
    const currentStart = instant(sorted[start]!.startsAt, 'bar start')
    if (currentStart - previousStart !== ONE_MINUTE_MS) break
    start -= 1
  }
  return sorted.slice(start)
}

function ratio(
  numerator: FinancialDecimal,
  denominator: FinancialDecimal,
): DecimalValue | null {
  if (denominator.isZero()) return null
  return decimalValue(roundToScale(numerator.div(denominator), OUTPUT_SCALE))
}

function closeReturn(
  earlier: MarketFeatureBarInput,
  later: MarketFeatureBarInput,
): DecimalValue | null {
  const earlierClose = decimal(earlier.close)
  if (earlierClose.isZero()) return null
  return ratio(decimal(later.close).minus(earlierClose), earlierClose)
}

function spreadFeatures(quote: MarketFeatureQuoteInput): {
  spreadAbsolute: DecimalValue | null
  spreadBps: DecimalValue | null
} {
  if (quote.bid === null || quote.ask === null) {
    return { spreadAbsolute: null, spreadBps: null }
  }
  const bid = requireNonNegative(quote.bid, 'quote bid')
  const ask = requireNonNegative(quote.ask, 'quote ask')
  if (ask.lt(bid)) throw new RangeError('Feature input has a crossed quote')
  const spread = ask.minus(bid)
  const midpoint = ask.plus(bid).div('2')
  return {
    spreadAbsolute: decimalValue(roundToScale(spread, OUTPUT_SCALE)),
    spreadBps: midpoint.isZero()
      ? null
      : decimalValue(
          roundToScale(spread.div(midpoint).mul('10000'), OUTPUT_SCALE),
        ),
  }
}

function relativeVolume20(
  bars: readonly MarketFeatureBarInput[],
): DecimalValue | null {
  if (bars.length < 21) return null
  const previous = bars.slice(-21, -1)
  const average = previous
    .reduce((sum, bar) => sum.plus(decimal(bar.volume)), decimal('0'))
    .div('20')
  return ratio(decimal(bars.at(-1)!.volume), average)
}

function realizedVolatility5m(
  bars: readonly MarketFeatureBarInput[],
): DecimalValue | null {
  if (bars.length < 6) return null
  const window = bars.slice(-6)
  let sumOfSquares = decimal('0')
  for (let index = 1; index < window.length; index += 1) {
    const previousClose = decimal(window[index - 1]!.close)
    if (previousClose.isZero()) return null
    const minuteReturn = decimal(window[index]!.close)
      .minus(previousClose)
      .div(previousClose)
    sumOfSquares = sumOfSquares.plus(minuteReturn.pow('2'))
  }
  return decimalValue(roundToScale(sumOfSquares.sqrt(), OUTPUT_SCALE))
}

function distanceFromSma5(
  bars: readonly MarketFeatureBarInput[],
): DecimalValue | null {
  if (bars.length < 5) return null
  const window = bars.slice(-5)
  const average = window
    .reduce((sum, bar) => sum.plus(decimal(bar.close)), decimal('0'))
    .div('5')
  return ratio(decimal(window.at(-1)!.close).minus(average), average)
}

function distanceFromTypicalPriceVwap20(
  bars: readonly MarketFeatureBarInput[],
): DecimalValue | null {
  if (bars.length < 20) return null
  const window = bars.slice(-20)
  let totalVolume = decimal('0')
  let weightedTypicalPrice = decimal('0')
  for (const bar of window) {
    const volume = decimal(bar.volume)
    const typicalPrice = decimal(bar.high)
      .plus(decimal(bar.low))
      .plus(decimal(bar.close))
      .div('3')
    totalVolume = totalVolume.plus(volume)
    weightedTypicalPrice = weightedTypicalPrice.plus(typicalPrice.mul(volume))
  }
  if (totalVolume.isZero()) return null
  const vwap = weightedTypicalPrice.div(totalVolume)
  return ratio(decimal(window.at(-1)!.close).minus(vwap), vwap)
}

export function computeDeterministicMarketFeatures(input: {
  quote: MarketFeatureQuoteInput
  bars: readonly MarketFeatureBarInput[]
}): DeterministicMarketFeatures {
  const sorted = sortedUniqueBars(input.bars)
  const contiguous = contiguousSuffix(sorted)
  const spread = spreadFeatures(input.quote)
  return {
    version: MARKET_FEATURE_VERSION,
    observedBarCount: sorted.length,
    contiguousBarCount: contiguous.length,
    ...spread,
    return1m:
      contiguous.length >= 2
        ? closeReturn(contiguous.at(-2)!, contiguous.at(-1)!)
        : null,
    return5m:
      contiguous.length >= 6
        ? closeReturn(contiguous.at(-6)!, contiguous.at(-1)!)
        : null,
    relativeVolume20: relativeVolume20(contiguous),
    realizedVolatility5m: realizedVolatility5m(contiguous),
    distanceFromSma5: distanceFromSma5(contiguous),
    distanceFromTypicalPriceVwap20: distanceFromTypicalPriceVwap20(contiguous),
  }
}
