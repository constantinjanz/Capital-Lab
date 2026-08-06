import {
  decimal,
  decimalValue,
  minDecimal,
  requireNonNegative,
  requirePositive,
  roundToIncrement,
  type DecimalValue,
  type FinancialDecimal,
} from '../financial/decimal'

export type RiskReason =
  | 'INSOLVENT'
  | 'GROSS_LEVERAGE_BREACH'
  | 'CONCENTRATION_BREACH'
  | 'TRADE_RISK_BREACH'
  | 'INITIAL_MARGIN_BREACH'
  | 'INSUFFICIENT_BUYING_POWER'
  | 'BORROW_UNAVAILABLE'
  | 'DAILY_LOSS_LIMIT'
  | 'DRAWDOWN_LIMIT'

export interface RiskConfig {
  readonly maximumGrossLeverage: DecimalValue
  readonly maximumSingleNameFraction: DecimalValue
  readonly maximumNewRiskFraction: DecimalValue
  readonly stopDistanceFraction: DecimalValue
  readonly stopGapBufferFraction: DecimalValue
  readonly longInitialMarginFraction: DecimalValue
  readonly shortInitialMarginFraction: DecimalValue
  readonly dailyLossPauseFraction: DecimalValue
  readonly drawdownPauseFraction: DecimalValue
}

export interface PositionSizingInput {
  readonly direction: 'long' | 'short'
  readonly navBase: DecimalValue
  readonly targetExposureFraction: DecimalValue
  readonly currentInstrumentAbsExposureBase: DecimalValue
  readonly currentGrossExposureBase: DecimalValue
  readonly reservedGrossExposureBase: DecimalValue
  readonly currentInitialMarginBase: DecimalValue
  readonly reservedInitialMarginBase: DecimalValue
  readonly entryPriceBase: DecimalValue
  readonly estimatedRoundTripFeesPerUnitBase: DecimalValue
  readonly quantityIncrement: DecimalValue
  readonly priceTickBase: DecimalValue
  readonly borrowAvailableQuantity?: DecimalValue
}

export interface PositionSizingResult {
  readonly accepted: boolean
  readonly quantity: DecimalValue
  readonly stopPriceBase: DecimalValue
  readonly plannedRiskBase: DecimalValue
  readonly limitingConstraints: readonly string[]
  readonly caps: Readonly<Record<string, DecimalValue>>
  readonly reasons: readonly RiskReason[]
}

function nonNegative(value: FinancialDecimal): FinancialDecimal {
  return value.isNegative() ? decimal('0') : value
}

function validateFraction(value: DecimalValue, name: string): FinancialDecimal {
  const fraction = requireNonNegative(value, name)
  if (fraction.gt(1)) throw new RangeError(`${name} cannot exceed one`)
  return fraction
}

export function sizeNewPosition(
  input: PositionSizingInput,
  config: RiskConfig,
): PositionSizingResult {
  const nav = requirePositive(input.navBase, 'navBase')
  const entry = requirePositive(input.entryPriceBase, 'entryPriceBase')
  const targetFraction = validateFraction(
    input.targetExposureFraction,
    'targetExposureFraction',
  )
  const maxSingle = validateFraction(
    config.maximumSingleNameFraction,
    'maximumSingleNameFraction',
  )
  const maxRisk = validateFraction(
    config.maximumNewRiskFraction,
    'maximumNewRiskFraction',
  )
  const stopDistance = validateFraction(
    config.stopDistanceFraction,
    'stopDistanceFraction',
  )
  const gapBuffer = validateFraction(
    config.stopGapBufferFraction,
    'stopGapBufferFraction',
  )
  const grossLimit = nav.mul(
    requirePositive(config.maximumGrossLeverage, 'maximumGrossLeverage'),
  )
  const currentInstrument = requireNonNegative(
    input.currentInstrumentAbsExposureBase,
    'currentInstrumentAbsExposureBase',
  )
  const currentGross = requireNonNegative(
    input.currentGrossExposureBase,
    'currentGrossExposureBase',
  )
  const reservedGross = requireNonNegative(
    input.reservedGrossExposureBase,
    'reservedGrossExposureBase',
  )
  const currentMargin = requireNonNegative(
    input.currentInitialMarginBase,
    'currentInitialMarginBase',
  )
  const reservedMargin = requireNonNegative(
    input.reservedInitialMarginBase,
    'reservedInitialMarginBase',
  )
  const feesPerUnit = requireNonNegative(
    input.estimatedRoundTripFeesPerUnitBase,
    'estimatedRoundTripFeesPerUnitBase',
  )
  const marginRate = validateFraction(
    input.direction === 'long'
      ? config.longInitialMarginFraction
      : config.shortInitialMarginFraction,
    'initialMarginFraction',
  )

  const targetCapacity = nonNegative(
    nav.mul(targetFraction).minus(currentInstrument),
  )
  const concentrationCapacity = nonNegative(
    nav.mul(maxSingle).minus(currentInstrument),
  )
  const leverageCapacity = nonNegative(
    grossLimit.minus(currentGross).minus(reservedGross),
  )
  const marginCapital = nonNegative(
    nav.minus(currentMargin).minus(reservedMargin),
  )
  const marginCapacity = marginRate.isZero()
    ? leverageCapacity
    : marginCapital.div(marginRate)
  const riskPerUnit = entry.mul(stopDistance.plus(gapBuffer)).plus(feesPerUnit)
  const riskCapacity = riskPerUnit.isZero()
    ? leverageCapacity
    : nav.mul(maxRisk).div(riskPerUnit).mul(entry)

  const capNotionals: Record<string, FinancialDecimal> = {
    target: targetCapacity,
    concentration: concentrationCapacity,
    leverage: leverageCapacity,
    margin: marginCapacity,
    tradeRisk: riskCapacity,
  }
  if (input.direction === 'short') {
    capNotionals.borrow =
      input.borrowAvailableQuantity === undefined
        ? decimal('0')
        : requireNonNegative(
            input.borrowAvailableQuantity,
            'borrowAvailableQuantity',
          ).mul(entry)
  }

  const minimumCapacity = minDecimal(Object.values(capNotionals))
  const rawQuantity = minimumCapacity.div(entry)
  const quantity = roundToIncrement(
    rawQuantity,
    input.quantityIncrement,
    'down',
  )
  const minimumNames = Object.entries(capNotionals)
    .filter(([, value]) => value.eq(minimumCapacity))
    .map(([name]) => name)
  const reasons: RiskReason[] = []
  if (quantity.isZero()) {
    if (input.direction === 'short' && capNotionals.borrow.isZero())
      reasons.push('BORROW_UNAVAILABLE')
    if (leverageCapacity.isZero()) reasons.push('GROSS_LEVERAGE_BREACH')
    if (concentrationCapacity.isZero()) reasons.push('CONCENTRATION_BREACH')
    if (marginCapacity.isZero()) reasons.push('INITIAL_MARGIN_BREACH')
    if (riskCapacity.isZero()) reasons.push('TRADE_RISK_BREACH')
    if (reasons.length === 0) reasons.push('INSUFFICIENT_BUYING_POWER')
  }

  const stopRaw =
    input.direction === 'long'
      ? entry.mul(decimal('1').minus(stopDistance))
      : entry.mul(decimal('1').plus(stopDistance))
  const stop = roundToIncrement(
    stopRaw,
    input.priceTickBase,
    input.direction === 'long' ? 'down' : 'up',
  )
  return {
    accepted: quantity.gt(0),
    quantity: decimalValue(quantity),
    stopPriceBase: decimalValue(stop),
    plannedRiskBase: decimalValue(quantity.mul(riskPerUnit)),
    limitingConstraints: minimumNames,
    caps: Object.fromEntries(
      Object.entries(capNotionals).map(([name, value]) => [
        name,
        decimalValue(value.div(entry)),
      ]),
    ),
    reasons,
  }
}

export function checkPostTradeRisk(input: {
  navBase: DecimalValue
  postGrossExposureBase: DecimalValue
  postInstrumentAbsExposureBase: DecimalValue
  postInitialMarginBase: DecimalValue
  plannedNewRiskBase: DecimalValue
  config: RiskConfig
}): readonly RiskReason[] {
  const nav = decimal(input.navBase)
  if (nav.lte(0)) return ['INSOLVENT']
  const reasons: RiskReason[] = []
  if (
    decimal(input.postGrossExposureBase).gt(
      nav.mul(decimal(input.config.maximumGrossLeverage)),
    )
  ) {
    reasons.push('GROSS_LEVERAGE_BREACH')
  }
  if (
    decimal(input.postInstrumentAbsExposureBase).gt(
      nav.mul(decimal(input.config.maximumSingleNameFraction)),
    )
  ) {
    reasons.push('CONCENTRATION_BREACH')
  }
  if (
    decimal(input.plannedNewRiskBase).gt(
      nav.mul(decimal(input.config.maximumNewRiskFraction)),
    )
  ) {
    reasons.push('TRADE_RISK_BREACH')
  }
  if (decimal(input.postInitialMarginBase).gt(nav))
    reasons.push('INITIAL_MARGIN_BREACH')
  return reasons
}

export function automaticPauseReasons(input: {
  currentNavBase: DecimalValue
  sessionOpeningNavBase: DecimalValue
  peakNavBase: DecimalValue
  config: RiskConfig
}): readonly RiskReason[] {
  const current = decimal(input.currentNavBase)
  if (current.lte(0)) return ['INSOLVENT']
  const opening = requirePositive(
    input.sessionOpeningNavBase,
    'sessionOpeningNavBase',
  )
  const peak = requirePositive(input.peakNavBase, 'peakNavBase')
  const dailyLoss = opening.minus(current).div(opening)
  const drawdown = peak.minus(current).div(peak)
  const reasons: RiskReason[] = []
  if (dailyLoss.gte(decimal(input.config.dailyLossPauseFraction)))
    reasons.push('DAILY_LOSS_LIMIT')
  if (drawdown.gte(decimal(input.config.drawdownPauseFraction)))
    reasons.push('DRAWDOWN_LIMIT')
  return reasons
}

export interface MarginPosition {
  readonly instrumentId: string
  readonly absMarketValueBase: DecimalValue
  readonly initialMarginFraction: DecimalValue
  readonly maintenanceMarginFraction: DecimalValue
}

export function calculateMargin(positions: readonly MarginPosition[]): {
  readonly initialRequirementBase: DecimalValue
  readonly maintenanceRequirementBase: DecimalValue
} {
  let initial = decimal('0')
  let maintenance = decimal('0')
  for (const position of positions) {
    const value = requireNonNegative(
      position.absMarketValueBase,
      'absMarketValueBase',
    )
    initial = initial.plus(
      value.mul(
        validateFraction(
          position.initialMarginFraction,
          'initialMarginFraction',
        ),
      ),
    )
    maintenance = maintenance.plus(
      value.mul(
        validateFraction(
          position.maintenanceMarginFraction,
          'maintenanceMarginFraction',
        ),
      ),
    )
  }
  return {
    initialRequirementBase: decimalValue(initial),
    maintenanceRequirementBase: decimalValue(maintenance),
  }
}

export function rankForcedLiquidations(
  positions: readonly (MarginPosition & { readonly quantity: DecimalValue })[],
): readonly (MarginPosition & { readonly quantity: DecimalValue })[] {
  return [...positions].sort((left, right) => {
    const leftRelief = decimal(left.absMarketValueBase).mul(
      decimal(left.maintenanceMarginFraction),
    )
    const rightRelief = decimal(right.absMarketValueBase).mul(
      decimal(right.maintenanceMarginFraction),
    )
    if (!leftRelief.eq(rightRelief)) return rightRelief.comparedTo(leftRelief)
    const byExposure = decimal(right.absMarketValueBase).comparedTo(
      decimal(left.absMarketValueBase),
    )
    return byExposure !== 0
      ? byExposure
      : left.instrumentId.localeCompare(right.instrumentId)
  })
}
