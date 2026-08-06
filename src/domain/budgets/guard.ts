import {
  decimal,
  decimalValue,
  type DecimalValue,
} from '@/domain/financial/decimal'

import {
  calculateUsageCost,
  CURRENT_MODEL_PRICING,
  type ModelId,
  type TokenUsage,
} from './pricing'

export type BudgetPolicy = {
  tradingDayHardLimitUsd: DecimalValue
  monthlySoftTargetUsd: DecimalValue
  monthlyHardLimitUsd: DecimalValue
  lifetimeHardLimitUsd: DecimalValue
  timezone: 'America/New_York'
}

export const DEFAULT_BUDGET_POLICY: BudgetPolicy = {
  tradingDayHardLimitUsd: '0.30',
  monthlySoftTargetUsd: '6.30',
  monthlyHardLimitUsd: '10.00',
  lifetimeHardLimitUsd: '50.00',
  timezone: 'America/New_York',
}

export type ReservationState =
  'reserved' | 'settled' | 'released' | 'unknown' | 'reconciled'

export type BudgetReservation = {
  id: string
  idempotencyKey: string
  model: ModelId
  tradingDay: string
  month: string
  worstCaseUsd: DecimalValue
  actualUsd?: DecimalValue
  state: ReservationState
  createdAt: string
}

export type ReservationRequest = {
  idempotencyKey: string
  model: ModelId
  at: string
  worstCaseUsage: TokenUsage
}

export type ReservationResult =
  | { accepted: true; reservation: BudgetReservation; duplicate: boolean }
  | {
      accepted: false
      reason: 'daily_limit' | 'monthly_limit' | 'lifetime_limit'
      worstCaseUsd: DecimalValue
    }

export type BudgetAlertLevel = '70_percent' | '90_percent' | '100_percent'

export type BudgetAlert = {
  period: 'trading_day' | 'month' | 'lifetime'
  level: BudgetAlertLevel
}

function alertLevel(used: ReturnType<typeof decimal>, limit: DecimalValue) {
  const utilization = used.div(limit)
  if (utilization.gte('1')) return '100_percent' as const
  if (utilization.gte('0.9')) return '90_percent' as const
  if (utilization.gte('0.7')) return '70_percent' as const
  return null
}

function budgetKeys(at: string): { tradingDay: string; month: string } {
  const date = new Date(at)
  if (Number.isNaN(date.getTime()))
    throw new TypeError('Invalid reservation time')
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((value) => value.type === type)?.value ?? ''
  const tradingDay = `${part('year')}-${part('month')}-${part('day')}`
  return { tradingDay, month: tradingDay.slice(0, 7) }
}

export class InMemoryBudgetGuard {
  private readonly reservations = new Map<string, BudgetReservation>()
  private transactionTail = Promise.resolve()

  constructor(private readonly policy: BudgetPolicy = DEFAULT_BUDGET_POLICY) {}

  private transact<T>(work: () => T | Promise<T>): Promise<T> {
    const result = this.transactionTail.then(work, work)
    this.transactionTail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private countedAmount(reservation: BudgetReservation) {
    if (reservation.state === 'released') return decimal('0')
    if (reservation.state === 'settled' || reservation.state === 'reconciled') {
      return decimal(reservation.actualUsd ?? reservation.worstCaseUsd)
    }
    return decimal(reservation.worstCaseUsd)
  }

  private total(predicate: (reservation: BudgetReservation) => boolean) {
    let value = decimal('0')
    for (const reservation of this.reservations.values()) {
      if (predicate(reservation))
        value = value.plus(this.countedAmount(reservation))
    }
    return value
  }

  reserve(request: ReservationRequest): Promise<ReservationResult> {
    return this.transact(() => {
      const previous = this.reservations.get(request.idempotencyKey)
      if (previous)
        return { accepted: true, reservation: previous, duplicate: true }

      const { tradingDay, month } = budgetKeys(request.at)
      const worstCaseUsd = calculateUsageCost(
        CURRENT_MODEL_PRICING[request.model],
        request.worstCaseUsage,
      )
      const worst = decimal(worstCaseUsd)
      const dayTotal = this.total((item) => item.tradingDay === tradingDay)
      const monthTotal = this.total((item) => item.month === month)
      const lifetimeTotal = this.total(() => true)

      if (dayTotal.plus(worst).gt(this.policy.tradingDayHardLimitUsd)) {
        return { accepted: false, reason: 'daily_limit', worstCaseUsd }
      }
      if (monthTotal.plus(worst).gt(this.policy.monthlyHardLimitUsd)) {
        return { accepted: false, reason: 'monthly_limit', worstCaseUsd }
      }
      if (lifetimeTotal.plus(worst).gt(this.policy.lifetimeHardLimitUsd)) {
        return { accepted: false, reason: 'lifetime_limit', worstCaseUsd }
      }

      const reservation: BudgetReservation = {
        id: `reservation-${this.reservations.size + 1}`,
        idempotencyKey: request.idempotencyKey,
        model: request.model,
        tradingDay,
        month,
        worstCaseUsd,
        state: 'reserved',
        createdAt: request.at,
      }
      this.reservations.set(request.idempotencyKey, reservation)
      return { accepted: true, reservation, duplicate: false }
    })
  }

  settle(
    idempotencyKey: string,
    usage: TokenUsage,
  ): Promise<BudgetReservation> {
    return this.transact(() => {
      const reservation = this.reservations.get(idempotencyKey)
      if (!reservation) throw new Error('Budget reservation not found')
      if (reservation.state === 'settled') return reservation
      if (reservation.state !== 'reserved' && reservation.state !== 'unknown') {
        throw new Error(`Cannot settle a ${reservation.state} reservation`)
      }
      const actualUsd = calculateUsageCost(
        CURRENT_MODEL_PRICING[reservation.model],
        usage,
      )
      const settled = { ...reservation, state: 'settled' as const, actualUsd }
      this.reservations.set(idempotencyKey, settled)
      return settled
    })
  }

  markUnknown(idempotencyKey: string): Promise<BudgetReservation> {
    return this.transact(() => this.transition(idempotencyKey, 'unknown'))
  }

  release(idempotencyKey: string): Promise<BudgetReservation> {
    return this.transact(() => this.transition(idempotencyKey, 'released'))
  }

  private transition(
    idempotencyKey: string,
    next: 'unknown' | 'released',
  ): BudgetReservation {
    const reservation = this.reservations.get(idempotencyKey)
    if (!reservation) throw new Error('Budget reservation not found')
    if (reservation.state === next) return reservation
    if (reservation.state !== 'reserved') {
      throw new Error(`Cannot mark ${reservation.state} as ${next}`)
    }
    const updated = { ...reservation, state: next }
    this.reservations.set(idempotencyKey, updated)
    return updated
  }

  snapshot(at: string) {
    const { tradingDay, month } = budgetKeys(at)
    const dailyUsed = this.total((item) => item.tradingDay === tradingDay)
    const monthlyUsed = this.total((item) => item.month === month)
    const lifetimeUsed = this.total(() => true)
    const alerts: BudgetAlert[] = []
    const periods = [
      ['trading_day', dailyUsed, this.policy.tradingDayHardLimitUsd],
      ['month', monthlyUsed, this.policy.monthlyHardLimitUsd],
      ['lifetime', lifetimeUsed, this.policy.lifetimeHardLimitUsd],
    ] as const
    for (const [period, used, limit] of periods) {
      const level = alertLevel(used, limit)
      if (level) alerts.push({ period, level })
    }
    return {
      tradingDay,
      month,
      dailyUsedUsd: decimalValue(dailyUsed),
      monthlyUsedUsd: decimalValue(monthlyUsed),
      lifetimeUsedUsd: decimalValue(lifetimeUsed),
      monthlySoftTargetExceeded: monthlyUsed.gte(
        this.policy.monthlySoftTargetUsd,
      ),
      hardLimitExhausted: alerts.some((alert) => alert.level === '100_percent'),
      alerts,
      reservations: [...this.reservations.values()],
    }
  }
}
