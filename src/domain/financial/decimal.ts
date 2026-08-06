import DecimalJs from 'decimal.js'

const CANONICAL_DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/

export const Decimal = DecimalJs.clone({
  precision: 50,
  rounding: DecimalJs.ROUND_HALF_EVEN,
  toExpNeg: -30,
  toExpPos: 30,
})

export type FinancialDecimal = DecimalJs
export type DecimalValue = string
export type RoundingDirection = 'down' | 'up' | 'nearest'

export function decimal(
  value: DecimalValue | FinancialDecimal,
): FinancialDecimal {
  if (Decimal.isDecimal(value)) {
    return new Decimal(value)
  }

  if (typeof value !== 'string' || !CANONICAL_DECIMAL.test(value)) {
    throw new TypeError(
      `Financial values must be canonical decimal strings: ${String(value)}`,
    )
  }

  const parsed = new Decimal(value)
  if (!parsed.isFinite()) {
    throw new TypeError('Financial values must be finite')
  }
  return parsed
}

export function decimalValue(value: FinancialDecimal): DecimalValue {
  if (!value.isFinite()) {
    throw new TypeError('Financial values must be finite')
  }
  return value.isZero() ? '0' : value.toFixed()
}

export function requirePositive(
  value: DecimalValue,
  name: string,
): FinancialDecimal {
  const parsed = decimal(value)
  if (parsed.lte(0)) {
    throw new RangeError(`${name} must be greater than zero`)
  }
  return parsed
}

export function requireNonNegative(
  value: DecimalValue,
  name: string,
): FinancialDecimal {
  const parsed = decimal(value)
  if (parsed.isNegative()) {
    throw new RangeError(`${name} must not be negative`)
  }
  return parsed
}

function roundingMode(direction: RoundingDirection): DecimalJs.Rounding {
  switch (direction) {
    case 'down':
      return DecimalJs.ROUND_FLOOR
    case 'up':
      return DecimalJs.ROUND_CEIL
    case 'nearest':
      return DecimalJs.ROUND_HALF_EVEN
  }
}

export function roundToIncrement(
  value: DecimalValue | FinancialDecimal,
  increment: DecimalValue,
  direction: RoundingDirection,
): FinancialDecimal {
  const step = requirePositive(increment, 'increment')
  const input = decimal(value)
  return input.div(step).toDecimalPlaces(0, roundingMode(direction)).mul(step)
}

export function roundToScale(
  value: DecimalValue | FinancialDecimal,
  scale: number,
  direction: RoundingDirection = 'nearest',
): FinancialDecimal {
  if (!Number.isInteger(scale) || scale < 0 || scale > 30) {
    throw new RangeError('scale must be an integer between 0 and 30')
  }
  return decimal(value).toDecimalPlaces(scale, roundingMode(direction))
}

export function minDecimal(
  values: readonly FinancialDecimal[],
): FinancialDecimal {
  if (values.length === 0) {
    throw new RangeError('At least one decimal is required')
  }
  return values.reduce((minimum, value) =>
    value.lt(minimum) ? value : minimum,
  )
}
