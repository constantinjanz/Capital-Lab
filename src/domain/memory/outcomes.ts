import {
  decimal,
  decimalValue,
  requirePositive,
  type DecimalValue,
} from '@/domain/financial/decimal'

export type OutcomePricePoint = {
  at: string
  instrumentPrice: DecimalValue
  benchmarkPrice: DecimalValue
}

export type DecisionOutcome = {
  horizon:
    '15_minutes' | '1_hour' | 'end_of_day' | '1_trading_day' | '5_trading_days'
  measuredAt: string
  forwardReturn: DecimalValue
  benchmarkRelativeReturn: DecimalValue
  maximumFavorableExcursion: DecimalValue
  maximumAdverseExcursion: DecimalValue
}

export function labelDecisionOutcome(input: {
  direction: 'long' | 'short'
  horizon: DecisionOutcome['horizon']
  entryInstrumentPrice: DecimalValue
  entryBenchmarkPrice: DecimalValue
  path: readonly OutcomePricePoint[]
  decisionAt: string
}): DecisionOutcome {
  if (input.path.length === 0) throw new Error('Outcome path is empty')
  const decisionTime = Date.parse(input.decisionAt)
  if (!Number.isFinite(decisionTime))
    throw new TypeError('Invalid decision time')
  const entry = requirePositive(
    input.entryInstrumentPrice,
    'entryInstrumentPrice',
  )
  const benchmarkEntry = requirePositive(
    input.entryBenchmarkPrice,
    'entryBenchmarkPrice',
  )
  const points = [...input.path].sort((left, right) =>
    left.at.localeCompare(right.at),
  )
  if (points.some((point) => Date.parse(point.at) <= decisionTime)) {
    throw new Error('Outcome observations must be strictly after the decision')
  }
  const direction = input.direction === 'long' ? decimal('1') : decimal('-1')
  const directedReturns = points.map((point) =>
    requirePositive(point.instrumentPrice, 'instrumentPrice')
      .div(entry)
      .minus('1')
      .mul(direction),
  )
  const terminal = directedReturns.at(-1)!
  const benchmarkReturn = requirePositive(
    points.at(-1)!.benchmarkPrice,
    'benchmarkPrice',
  )
    .div(benchmarkEntry)
    .minus('1')
  let favorable = decimal('0')
  let adverse = decimal('0')
  for (const value of directedReturns) {
    if (value.gt(favorable)) favorable = value
    if (value.lt(adverse)) adverse = value
  }
  return {
    horizon: input.horizon,
    measuredAt: points.at(-1)!.at,
    forwardReturn: decimalValue(terminal),
    benchmarkRelativeReturn: decimalValue(terminal.minus(benchmarkReturn)),
    maximumFavorableExcursion: decimalValue(favorable),
    maximumAdverseExcursion: decimalValue(adverse),
  }
}
