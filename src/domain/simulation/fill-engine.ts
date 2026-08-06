import {
  decimal,
  decimalValue,
  requireNonNegative,
  requirePositive,
  roundToIncrement,
  type DecimalValue,
  type FinancialDecimal,
} from '../financial/decimal'
import type { MarketBar, MarketQuote } from '../market-data/types'
import { isTerminalOrder, remainingQuantity, validateOrder } from './orders'
import type { FillDraft, FillEvaluation, SimulationOrder } from './types'

const BASIS_POINTS = decimal('10000')

export interface FillModelConfig {
  readonly slippageBps: DecimalValue
  readonly priceTick: DecimalValue
  readonly quantityIncrement: DecimalValue
  readonly allowPartialFills: boolean
  readonly participationRate: DecimalValue
  readonly staleAfterMs: number
}

export interface FillContext {
  readonly simulationAsOf: string
  readonly regularSessionOpen: boolean
}

function milliseconds(value: string): number {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed))
    throw new TypeError(`Invalid timestamp: ${value}`)
  return parsed
}

function validateConfig(config: FillModelConfig): void {
  requireNonNegative(config.slippageBps, 'slippageBps')
  requirePositive(config.priceTick, 'priceTick')
  requirePositive(config.quantityIncrement, 'quantityIncrement')
  const participation = requireNonNegative(
    config.participationRate,
    'participationRate',
  )
  if (participation.gt(1))
    throw new RangeError('participationRate cannot exceed one')
  if (!Number.isInteger(config.staleAfterMs) || config.staleAfterMs < 0) {
    throw new RangeError('staleAfterMs must be a non-negative integer')
  }
}

function isBuySide(order: SimulationOrder): boolean {
  return order.side === 'buy' || order.side === 'buy_to_cover'
}

function fillQuantity(
  order: SimulationOrder,
  displayedLiquidity: DecimalValue | undefined,
  config: FillModelConfig,
): FinancialDecimal | undefined {
  const remaining = decimal(remainingQuantity(order))
  if (!config.allowPartialFills) return remaining
  if (displayedLiquidity === undefined) return undefined
  const available = roundToIncrement(
    requireNonNegative(displayedLiquidity, 'displayedLiquidity').mul(
      decimal(config.participationRate),
    ),
    config.quantityIncrement,
    'down',
  )
  if (available.isZero()) return undefined
  return available.lt(remaining) ? available : remaining
}

function slippedPrice(
  price: FinancialDecimal,
  buy: boolean,
  config: FillModelConfig,
): FinancialDecimal {
  const slippage = decimal(config.slippageBps).div(BASIS_POINTS)
  const raw = buy
    ? price.mul(decimal('1').plus(slippage))
    : price.mul(decimal('1').minus(slippage))
  return roundToIncrement(raw, config.priceTick, buy ? 'up' : 'down')
}

function quoteLimitPrice(
  order: SimulationOrder,
  executablePrice: FinancialDecimal,
  buy: boolean,
  config: FillModelConfig,
): FinancialDecimal | undefined {
  if (order.limitPrice === undefined)
    return slippedPrice(executablePrice, buy, config)
  const limit = decimal(order.limitPrice)
  if ((buy && executablePrice.gt(limit)) || (!buy && executablePrice.lt(limit)))
    return undefined
  const slipped = slippedPrice(executablePrice, buy, config)
  return buy
    ? slipped.gt(limit)
      ? limit
      : slipped
    : slipped.lt(limit)
      ? limit
      : slipped
}

function makeFill(
  order: SimulationOrder,
  quantity: FinancialDecimal,
  price: FinancialDecimal,
  fillAt: string,
  observedAt: string,
  marketDataId: string,
  triggeredAt?: string,
): FillEvaluation {
  const fill: FillDraft = {
    orderId: order.id,
    instrumentId: order.instrumentId,
    side: order.side,
    quantity: decimalValue(quantity),
    price: decimalValue(price),
    quoteNotional: decimalValue(quantity.mul(price)),
    currency: order.currency,
    fillAt,
    observedAt,
    marketDataIds: [marketDataId],
    ...(triggeredAt === undefined ? {} : { triggeredAt }),
  }
  return { kind: 'fill', fill }
}

function validateOrderForFill(
  order: SimulationOrder,
): FillEvaluation | undefined {
  validateOrder(order)
  if (
    isTerminalOrder(order) ||
    order.status === 'pending' ||
    order.status === 'accepted'
  ) {
    return { kind: 'no_fill', reason: 'NOT_ACTIVE' }
  }
  return undefined
}

export function evaluateQuoteFill(
  order: SimulationOrder,
  quote: MarketQuote,
  config: FillModelConfig,
  context: FillContext,
): FillEvaluation {
  validateConfig(config)
  const invalidOrder = validateOrderForFill(order)
  if (invalidOrder !== undefined) return invalidOrder
  if (!context.regularSessionOpen)
    return { kind: 'no_fill', reason: 'MARKET_CLOSED' }
  if (
    quote.instrumentId !== order.instrumentId ||
    quote.currency !== order.currency
  ) {
    return { kind: 'no_fill', reason: 'INVALID_MARKET_DATA' }
  }
  if (milliseconds(quote.availableAt) > milliseconds(context.simulationAsOf)) {
    return { kind: 'no_fill', reason: 'DATA_NOT_AVAILABLE' }
  }
  if (milliseconds(quote.providerEventAt) < milliseconds(order.eligibleAt)) {
    return { kind: 'no_fill', reason: 'NOT_YET_ELIGIBLE' }
  }
  if (
    milliseconds(quote.availableAt) - milliseconds(quote.providerEventAt) >
    config.staleAfterMs
  ) {
    return { kind: 'no_fill', reason: 'STALE_MARKET_DATA' }
  }

  const bid = requirePositive(quote.bid, 'quote.bid')
  const ask = requirePositive(quote.ask, 'quote.ask')
  if (bid.gt(ask)) return { kind: 'no_fill', reason: 'INVALID_MARKET_DATA' }
  const buy = isBuySide(order)
  const executable = buy ? ask : bid
  let triggeredAt: string | undefined

  if (
    (order.type === 'stop' || order.type === 'stop_limit') &&
    order.status !== 'triggered'
  ) {
    const stop = decimal(order.stopPrice!)
    const triggered = buy ? ask.gte(stop) : bid.lte(stop)
    if (!triggered) return { kind: 'no_fill', reason: 'STOP_NOT_TRIGGERED' }
    triggeredAt = quote.availableAt
  }

  const usesLimit = order.type === 'limit' || order.type === 'stop_limit'
  const price = usesLimit
    ? quoteLimitPrice(order, executable, buy, config)
    : slippedPrice(executable, buy, config)
  if (price === undefined) {
    return triggeredAt === undefined
      ? { kind: 'no_fill', reason: 'LIMIT_NOT_REACHED' }
      : { kind: 'triggered', triggeredAt }
  }

  const quantity = fillQuantity(
    order,
    buy ? quote.askSize : quote.bidSize,
    config,
  )
  if (quantity === undefined) return { kind: 'no_fill', reason: 'NO_LIQUIDITY' }
  return makeFill(
    order,
    quantity,
    price,
    quote.availableAt,
    quote.availableAt,
    quote.id,
    triggeredAt,
  )
}

function validBar(bar: MarketBar): boolean {
  const open = requirePositive(bar.open, 'bar.open')
  const high = requirePositive(bar.high, 'bar.high')
  const low = requirePositive(bar.low, 'bar.low')
  const close = requirePositive(bar.close, 'bar.close')
  return (
    high.gte(open) &&
    high.gte(close) &&
    low.lte(open) &&
    low.lte(close) &&
    high.gte(low)
  )
}

export function evaluateBarFill(
  order: SimulationOrder,
  bar: MarketBar,
  config: FillModelConfig,
  context: FillContext,
): FillEvaluation {
  validateConfig(config)
  const invalidOrder = validateOrderForFill(order)
  if (invalidOrder !== undefined) return invalidOrder
  if (!context.regularSessionOpen)
    return { kind: 'no_fill', reason: 'MARKET_CLOSED' }
  if (
    bar.instrumentId !== order.instrumentId ||
    bar.currency !== order.currency ||
    !validBar(bar)
  ) {
    return { kind: 'no_fill', reason: 'INVALID_MARKET_DATA' }
  }
  if (milliseconds(bar.availableAt) > milliseconds(context.simulationAsOf)) {
    return { kind: 'no_fill', reason: 'DATA_NOT_AVAILABLE' }
  }
  if (milliseconds(bar.startAt) < milliseconds(order.eligibleAt)) {
    return { kind: 'no_fill', reason: 'NOT_YET_ELIGIBLE' }
  }
  if (
    milliseconds(bar.availableAt) - milliseconds(bar.endAt) >
    config.staleAfterMs
  ) {
    return { kind: 'no_fill', reason: 'STALE_MARKET_DATA' }
  }

  const buy = isBuySide(order)
  const open = decimal(bar.open)
  const high = decimal(bar.high)
  const low = decimal(bar.low)
  let triggeredAt: string | undefined

  if (
    (order.type === 'stop' || order.type === 'stop_limit') &&
    order.status !== 'triggered'
  ) {
    const stop = decimal(order.stopPrice!)
    const gapTriggered = buy ? open.gte(stop) : open.lte(stop)
    const intrabarTriggered = buy ? high.gte(stop) : low.lte(stop)
    if (!gapTriggered) {
      return intrabarTriggered
        ? { kind: 'triggered', triggeredAt: bar.endAt }
        : { kind: 'no_fill', reason: 'STOP_NOT_TRIGGERED' }
    }
    triggeredAt = bar.startAt
  }

  let price: FinancialDecimal | undefined
  const usesLimit = order.type === 'limit' || order.type === 'stop_limit'
  if (!usesLimit) {
    price = slippedPrice(open, buy, config)
  } else {
    const limit = decimal(order.limitPrice!)
    const openMarketable = buy ? open.lte(limit) : open.gte(limit)
    const touched = buy ? low.lte(limit) : high.gte(limit)
    if (openMarketable) {
      price = quoteLimitPrice(order, open, buy, config)
    } else if (touched) {
      price = limit
    }
  }
  if (price === undefined) {
    return triggeredAt === undefined
      ? { kind: 'no_fill', reason: 'LIMIT_NOT_REACHED' }
      : { kind: 'triggered', triggeredAt }
  }

  const quantity = fillQuantity(order, bar.volume, config)
  if (quantity === undefined) return { kind: 'no_fill', reason: 'NO_LIQUIDITY' }
  return makeFill(
    order,
    quantity,
    price,
    bar.startAt,
    bar.availableAt,
    bar.id,
    triggeredAt,
  )
}
