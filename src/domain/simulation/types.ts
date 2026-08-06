import type { DecimalValue } from '../financial/decimal'

export type OrderSide = 'buy' | 'sell' | 'sell_short' | 'buy_to_cover'
export type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit'
export type TimeInForce = 'day' | 'gtc'
export type OrderStatus =
  | 'pending'
  | 'accepted'
  | 'active'
  | 'triggered'
  | 'partially_filled'
  | 'filled'
  | 'cancelled'
  | 'expired'
  | 'rejected'

export interface SimulationOrder {
  readonly id: string
  readonly experimentId: string
  readonly instrumentId: string
  readonly currency: string
  readonly side: OrderSide
  readonly type: OrderType
  readonly timeInForce: TimeInForce
  readonly status: OrderStatus
  readonly quantity: DecimalValue
  readonly filledQuantity: DecimalValue
  readonly limitPrice?: DecimalValue
  readonly stopPrice?: DecimalValue
  readonly decisionAt: string
  readonly submittedAt: string
  readonly acceptedAt: string
  readonly eligibleAt: string
  readonly expiresAt?: string
  readonly reduceOnly: boolean
  readonly parentOrderId?: string
  readonly idempotencyKey: string
  readonly simulatorConfigVersionId: string
  readonly riskConfigVersionId: string
}

export type NoFillReason =
  | 'NOT_ACTIVE'
  | 'NOT_YET_ELIGIBLE'
  | 'MARKET_CLOSED'
  | 'STALE_MARKET_DATA'
  | 'INVALID_MARKET_DATA'
  | 'LIMIT_NOT_REACHED'
  | 'STOP_NOT_TRIGGERED'
  | 'NO_LIQUIDITY'
  | 'DATA_NOT_AVAILABLE'

export interface FillDraft {
  readonly orderId: string
  readonly instrumentId: string
  readonly side: OrderSide
  readonly quantity: DecimalValue
  readonly price: DecimalValue
  readonly quoteNotional: DecimalValue
  readonly currency: string
  readonly fillAt: string
  readonly observedAt: string
  readonly marketDataIds: readonly string[]
  readonly triggeredAt?: string
}

export type FillEvaluation =
  | { readonly kind: 'no_fill'; readonly reason: NoFillReason }
  | { readonly kind: 'triggered'; readonly triggeredAt: string }
  | { readonly kind: 'fill'; readonly fill: FillDraft }

export interface AccountedFill extends FillDraft {
  readonly id: string
  readonly baseCurrency: string
  readonly quoteToBaseRate: DecimalValue
  readonly fxRateId: string
  readonly baseNotional: DecimalValue
  readonly commissionBase: DecimalValue
  readonly regulatoryFeeBase: DecimalValue
  readonly totalFeesBase: DecimalValue
  readonly idempotencyKey: string
}
