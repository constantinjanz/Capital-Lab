import { z } from 'zod'

export const decimalTextSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/, 'Expected a canonical decimal string')

export const marketQuoteSchema = z.object({
  id: z.string().min(1),
  instrumentId: z.string().min(1),
  symbol: z.string().min(1).max(32),
  bidPrice: decimalTextSchema,
  askPrice: decimalTextSchema,
  bidSize: decimalTextSchema,
  askSize: decimalTextSchema,
  currency: z.string().length(3),
  provider: z.string().min(1),
  providerEventAt: z.iso.datetime(),
  providerReceivedAt: z.iso.datetime().optional(),
  firstSeenAt: z.iso.datetime(),
  availableAt: z.iso.datetime(),
  ingestedAt: z.iso.datetime(),
  sourceIdentifier: z.string().min(1),
  revision: z.string().min(1),
  synthetic: z.boolean(),
})

export type MarketQuote = z.infer<typeof marketQuoteSchema>

export const marketBarSchema = z.object({
  id: z.string().min(1),
  instrumentId: z.string().min(1),
  symbol: z.string().min(1).max(32),
  timeframe: z.string().min(1),
  startAt: z.iso.datetime(),
  endAt: z.iso.datetime(),
  open: decimalTextSchema,
  high: decimalTextSchema,
  low: decimalTextSchema,
  close: decimalTextSchema,
  volume: decimalTextSchema,
  currency: z.string().length(3),
  provider: z.string().min(1),
  firstSeenAt: z.iso.datetime(),
  availableAt: z.iso.datetime(),
  ingestedAt: z.iso.datetime(),
  sourceIdentifier: z.string().min(1),
  revision: z.string().min(1),
  synthetic: z.boolean(),
})

export type MarketBar = z.infer<typeof marketBarSchema>

export interface MarketDataProvider {
  readonly name: string
  readonly mode: 'mock' | 'live'
  getLatestQuotes(
    symbols: readonly string[],
    observedAt: string,
  ): Promise<MarketQuote[]>
  getBars(
    symbols: readonly string[],
    startAt: string,
    endAt: string,
    timeframe: string,
    observedAt: string,
  ): Promise<MarketBar[]>
}
