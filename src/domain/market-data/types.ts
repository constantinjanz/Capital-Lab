import type { DecimalValue } from '../financial/decimal'

export interface PointInTimeRecord {
  readonly id: string
  readonly sourceId: string
  readonly logicalId: string
  readonly revision: number
  readonly providerEventAt: string
  readonly providerReceivedAt?: string
  readonly firstSeenAt: string
  readonly availableAt: string
  readonly ingestedAt: string
  readonly revisionOf?: string
}

export interface MarketQuote extends PointInTimeRecord {
  readonly kind: 'quote'
  readonly instrumentId: string
  readonly currency: string
  readonly bid: DecimalValue
  readonly ask: DecimalValue
  readonly bidSize?: DecimalValue
  readonly askSize?: DecimalValue
}

export interface MarketBar extends PointInTimeRecord {
  readonly kind: 'bar'
  readonly instrumentId: string
  readonly currency: string
  readonly startAt: string
  readonly endAt: string
  readonly open: DecimalValue
  readonly high: DecimalValue
  readonly low: DecimalValue
  readonly close: DecimalValue
  readonly volume?: DecimalValue
}

export interface FxRate extends PointInTimeRecord {
  readonly kind: 'fx'
  readonly quoteCurrency: string
  readonly baseCurrency: string
  readonly quoteToBaseRate: DecimalValue
}

export type ExecutableMarketData = MarketQuote | MarketBar
