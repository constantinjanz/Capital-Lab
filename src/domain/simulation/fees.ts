import {
  decimal,
  decimalValue,
  requireNonNegative,
  roundToScale,
  type DecimalValue,
  type FinancialDecimal,
  type RoundingDirection,
} from '../financial/decimal'
import { convertQuoteToBase } from '../financial/money'
import type { AccountedFill, FillDraft, OrderSide } from './types'

const BASIS_POINTS = decimal('10000')

export interface FeeSchedule {
  readonly commissionPerShare: DecimalValue
  readonly commissionBps: DecimalValue
  readonly minimumCommission: DecimalValue
  readonly sellRegulatoryFeeBps: DecimalValue
  readonly currencyScale: number
  readonly rounding: RoundingDirection
}

export interface IncrementalFeeInput {
  readonly side: OrderSide
  readonly cumulativeQuantityBefore: DecimalValue
  readonly cumulativeNotionalBefore: DecimalValue
  readonly fillQuantity: DecimalValue
  readonly fillNotional: DecimalValue
  readonly commissionChargedBefore: DecimalValue
  readonly regulatoryFeeChargedBefore: DecimalValue
}

export interface FeeBreakdown {
  readonly commission: DecimalValue
  readonly regulatoryFee: DecimalValue
  readonly total: DecimalValue
}

function roundedFee(
  value: FinancialDecimal,
  schedule: FeeSchedule,
): FinancialDecimal {
  return roundToScale(value, schedule.currencyScale, schedule.rounding)
}

export function calculateIncrementalFees(
  input: IncrementalFeeInput,
  schedule: FeeSchedule,
): FeeBreakdown {
  const cumulativeQuantity = requireNonNegative(
    input.cumulativeQuantityBefore,
    'cumulativeQuantityBefore',
  ).plus(requirePositiveFeeInput(input.fillQuantity, 'fillQuantity'))
  const cumulativeNotional = requireNonNegative(
    input.cumulativeNotionalBefore,
    'cumulativeNotionalBefore',
  ).plus(requirePositiveFeeInput(input.fillNotional, 'fillNotional'))
  const commissionRaw = cumulativeQuantity
    .mul(requireNonNegative(schedule.commissionPerShare, 'commissionPerShare'))
    .plus(
      cumulativeNotional
        .mul(requireNonNegative(schedule.commissionBps, 'commissionBps'))
        .div(BASIS_POINTS),
    )
  const minimum = requireNonNegative(
    schedule.minimumCommission,
    'minimumCommission',
  )
  const cumulativeCommission = roundedFee(
    commissionRaw.lt(minimum) ? minimum : commissionRaw,
    schedule,
  )
  const alreadyCommission = requireNonNegative(
    input.commissionChargedBefore,
    'commissionChargedBefore',
  )
  const commission = cumulativeCommission.minus(alreadyCommission)

  const isSell = input.side === 'sell' || input.side === 'sell_short'
  const regulatoryRaw = isSell
    ? cumulativeNotional
        .mul(
          requireNonNegative(
            schedule.sellRegulatoryFeeBps,
            'sellRegulatoryFeeBps',
          ),
        )
        .div(BASIS_POINTS)
    : decimal('0')
  const cumulativeRegulatory = roundedFee(regulatoryRaw, schedule)
  const regulatory = cumulativeRegulatory.minus(
    requireNonNegative(
      input.regulatoryFeeChargedBefore,
      'regulatoryFeeChargedBefore',
    ),
  )
  const safeCommission = commission.isNegative() ? decimal('0') : commission
  const safeRegulatory = regulatory.isNegative() ? decimal('0') : regulatory
  return {
    commission: decimalValue(safeCommission),
    regulatoryFee: decimalValue(safeRegulatory),
    total: decimalValue(safeCommission.plus(safeRegulatory)),
  }
}

function requirePositiveFeeInput(
  value: DecimalValue,
  name: string,
): FinancialDecimal {
  const parsed = decimal(value)
  if (parsed.lte(0)) throw new RangeError(`${name} must be greater than zero`)
  return parsed
}

export function accountFill(input: {
  readonly id: string
  readonly fill: FillDraft
  readonly fee: FeeBreakdown
  readonly baseCurrency: string
  readonly quoteToBaseRate: DecimalValue
  readonly fxRateId: string
  readonly baseCurrencyScale: number
  readonly idempotencyKey: string
}): AccountedFill {
  const conversion = (amount: DecimalValue, rounding: RoundingDirection) =>
    convertQuoteToBase({
      quoteCurrency: input.fill.currency,
      baseCurrency: input.baseCurrency,
      quoteAmount: amount,
      quoteToBaseRate: input.quoteToBaseRate,
      fxRateId: input.fxRateId,
      baseCurrencyScale: input.baseCurrencyScale,
      rounding,
    }).baseAmount

  const commissionBase = conversion(input.fee.commission, 'up')
  const regulatoryFeeBase = conversion(input.fee.regulatoryFee, 'up')
  return {
    ...input.fill,
    id: input.id,
    baseCurrency: input.baseCurrency,
    quoteToBaseRate: input.quoteToBaseRate,
    fxRateId: input.fxRateId,
    baseNotional: conversion(input.fill.quoteNotional, 'nearest'),
    commissionBase,
    regulatoryFeeBase,
    totalFeesBase: decimalValue(
      decimal(commissionBase).plus(decimal(regulatoryFeeBase)),
    ),
    idempotencyKey: input.idempotencyKey,
  }
}
