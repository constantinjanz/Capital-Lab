import {
  decimal,
  decimalValue,
  requireNonNegative,
  requirePositive,
} from '../financial/decimal'
import type { OrderStatus, SimulationOrder } from './types'

const TERMINAL_STATUSES: readonly OrderStatus[] = [
  'filled',
  'cancelled',
  'expired',
  'rejected',
]

const ALLOWED_TRANSITIONS: Readonly<
  Record<OrderStatus, readonly OrderStatus[]>
> = {
  pending: ['accepted', 'rejected', 'cancelled'],
  accepted: ['active', 'rejected', 'cancelled', 'expired'],
  active: [
    'triggered',
    'partially_filled',
    'filled',
    'cancelled',
    'expired',
    'rejected',
  ],
  triggered: ['partially_filled', 'filled', 'cancelled', 'expired', 'rejected'],
  partially_filled: [
    'partially_filled',
    'filled',
    'cancelled',
    'expired',
    'rejected',
  ],
  filled: [],
  cancelled: [],
  expired: [],
  rejected: [],
}

export function validateOrder(order: SimulationOrder): void {
  const quantity = requirePositive(order.quantity, 'order.quantity')
  const filled = requireNonNegative(
    order.filledQuantity,
    'order.filledQuantity',
  )
  if (filled.gt(quantity))
    throw new RangeError('filled quantity cannot exceed order quantity')
  if (
    (order.type === 'limit' || order.type === 'stop_limit') &&
    order.limitPrice === undefined
  ) {
    throw new TypeError(
      'limitPrice is required for limit and stop-limit orders',
    )
  }
  if (
    (order.type === 'stop' || order.type === 'stop_limit') &&
    order.stopPrice === undefined
  ) {
    throw new TypeError('stopPrice is required for stop and stop-limit orders')
  }
  if (order.limitPrice !== undefined)
    requirePositive(order.limitPrice, 'order.limitPrice')
  if (order.stopPrice !== undefined)
    requirePositive(order.stopPrice, 'order.stopPrice')
  if (Date.parse(order.eligibleAt) < Date.parse(order.acceptedAt)) {
    throw new RangeError('eligibleAt cannot precede acceptedAt')
  }
}

export function remainingQuantity(order: SimulationOrder): string {
  validateOrder(order)
  return decimalValue(
    decimal(order.quantity).minus(decimal(order.filledQuantity)),
  )
}

export function isTerminalOrder(order: SimulationOrder): boolean {
  return TERMINAL_STATUSES.includes(order.status)
}

export function transitionOrder(
  order: SimulationOrder,
  nextStatus: OrderStatus,
): SimulationOrder {
  if (!ALLOWED_TRANSITIONS[order.status].includes(nextStatus)) {
    throw new Error(
      `Invalid order transition: ${order.status} -> ${nextStatus}`,
    )
  }
  return { ...order, status: nextStatus }
}
