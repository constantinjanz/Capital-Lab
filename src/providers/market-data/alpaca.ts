import 'server-only'

import { z } from 'zod'

import { parseJsonWithNumbersAsStrings } from '@/lib/security/json-numbers'

import type { MarketBar, MarketDataProvider, MarketQuote } from './types'

const ALPACA_MARKET_DATA_ORIGIN = 'https://data.alpaca.markets'

const quotePayloadSchema = z.object({
  quotes: z.record(
    z.string(),
    z.object({
      ap: z.string(),
      as: z.string(),
      bp: z.string(),
      bs: z.string(),
      t: z.iso.datetime(),
    }),
  ),
})

const barsPayloadSchema = z.object({
  bars: z.record(
    z.string(),
    z.array(
      z.object({
        t: z.iso.datetime(),
        o: z.string(),
        h: z.string(),
        l: z.string(),
        c: z.string(),
        v: z.string(),
      }),
    ),
  ),
})

type AlpacaMarketDataOptions = {
  keyId: string
  secretKey: string
  feed: 'iex' | 'sip' | 'delayed_sip'
  fetcher?: typeof fetch
}

function barEndAt(startAt: string, timeframe: string): string {
  const match = /^(\d+)(Min|Hour|Day)$/.exec(timeframe)
  if (!match) throw new Error(`Unsupported Alpaca timeframe: ${timeframe}`)
  const quantity = Number(match[1])
  const unitMs =
    match[2] === 'Min' ? 60_000 : match[2] === 'Hour' ? 3_600_000 : 86_400_000
  const start = Date.parse(startAt)
  if (!Number.isFinite(start))
    throw new TypeError('Invalid Alpaca bar timestamp')
  return new Date(start + quantity * unitMs).toISOString()
}

export class AlpacaMarketDataProvider implements MarketDataProvider {
  readonly name = 'alpaca-market-data'
  readonly mode = 'live' as const
  private readonly fetcher: typeof fetch

  constructor(private readonly options: AlpacaMarketDataOptions) {
    this.fetcher = options.fetcher ?? fetch
  }

  private async request(pathname: string, parameters: URLSearchParams) {
    const url = new URL(pathname, ALPACA_MARKET_DATA_ORIGIN)
    url.search = parameters.toString()
    if (url.origin !== ALPACA_MARKET_DATA_ORIGIN) {
      throw new Error('Alpaca adapter refused a non-market-data origin')
    }
    const response = await this.fetcher(url, {
      headers: {
        'APCA-API-KEY-ID': this.options.keyId,
        'APCA-API-SECRET-KEY': this.options.secretKey,
        Accept: 'application/json',
      },
      cache: 'no-store',
    })
    if (!response.ok) {
      throw new Error(
        `Alpaca Market Data request failed with ${response.status}`,
      )
    }
    return parseJsonWithNumbersAsStrings(await response.text())
  }

  async getLatestQuotes(
    symbols: readonly string[],
    observedAt: string,
  ): Promise<MarketQuote[]> {
    const payload = quotePayloadSchema.parse(
      await this.request(
        '/v2/stocks/quotes/latest',
        new URLSearchParams({
          symbols: symbols.join(','),
          feed: this.options.feed,
        }),
      ),
    )
    return Object.entries(payload.quotes).map(([symbol, quote]) => ({
      id: `alpaca-quote-${symbol}-${quote.t}`,
      instrumentId: `symbol:${symbol}`,
      symbol,
      bidPrice: quote.bp,
      askPrice: quote.ap,
      bidSize: quote.bs,
      askSize: quote.as,
      currency: 'USD',
      provider: this.name,
      providerEventAt: quote.t,
      firstSeenAt: observedAt,
      availableAt: observedAt,
      ingestedAt: observedAt,
      sourceIdentifier: `${symbol}:${quote.t}`,
      revision: 'original',
      synthetic: false,
    }))
  }

  async getBars(
    symbols: readonly string[],
    startAt: string,
    endAt: string,
    timeframe: string,
    observedAt: string,
  ): Promise<MarketBar[]> {
    const payload = barsPayloadSchema.parse(
      await this.request(
        '/v2/stocks/bars',
        new URLSearchParams({
          symbols: symbols.join(','),
          start: startAt,
          end: endAt,
          timeframe,
          feed: this.options.feed,
          adjustment: 'all',
        }),
      ),
    )
    return Object.entries(payload.bars).flatMap(([symbol, bars]) =>
      bars.map((bar) => ({
        id: `alpaca-bar-${symbol}-${timeframe}-${bar.t}`,
        instrumentId: `symbol:${symbol}`,
        symbol,
        timeframe,
        startAt: bar.t,
        endAt: barEndAt(bar.t, timeframe),
        open: bar.o,
        high: bar.h,
        low: bar.l,
        close: bar.c,
        volume: bar.v,
        currency: 'USD',
        provider: this.name,
        firstSeenAt: observedAt,
        availableAt: observedAt,
        ingestedAt: observedAt,
        sourceIdentifier: `${symbol}:${timeframe}:${bar.t}`,
        revision: 'original',
        synthetic: false,
      })),
    )
  }
}
