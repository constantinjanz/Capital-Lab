import type { MarketBar, MarketDataProvider, MarketQuote } from './types'

const prices: Record<string, { bid: string; ask: string }> = {
  SPY: { bid: '612.34', ask: '612.36' },
  QQQ: { bid: '541.12', ask: '541.15' },
  AAPL: { bid: '221.08', ask: '221.11' },
  MSFT: { bid: '503.42', ask: '503.47' },
  NVDA: { bid: '179.65', ask: '179.69' },
}

export class MockMarketDataProvider implements MarketDataProvider {
  readonly name = 'deterministic-mock-market-data'
  readonly mode = 'mock' as const

  async getLatestQuotes(
    symbols: readonly string[],
    observedAt: string,
  ): Promise<MarketQuote[]> {
    return symbols.map((symbol, index) => {
      const normalized = symbol.toUpperCase()
      const price = prices[normalized] ?? { bid: '100.00', ask: '100.05' }
      return {
        id: `mock-quote-${normalized}-${observedAt}`,
        instrumentId: `mock-instrument-${normalized}`,
        symbol: normalized,
        bidPrice: price.bid,
        askPrice: price.ask,
        bidSize: String(100 + index * 10),
        askSize: String(120 + index * 10),
        currency: 'USD',
        provider: this.name,
        providerEventAt: observedAt,
        firstSeenAt: observedAt,
        availableAt: observedAt,
        ingestedAt: observedAt,
        sourceIdentifier: `mock:${normalized}:${observedAt}`,
        revision: 'original',
        synthetic: true,
      }
    })
  }

  async getBars(
    symbols: readonly string[],
    startAt: string,
    endAt: string,
    timeframe: string,
    observedAt: string,
  ): Promise<MarketBar[]> {
    return symbols.map((symbol) => {
      const normalized = symbol.toUpperCase()
      const price = prices[normalized] ?? { bid: '100.00', ask: '100.05' }
      return {
        id: `mock-bar-${normalized}-${startAt}`,
        instrumentId: `mock-instrument-${normalized}`,
        symbol: normalized,
        timeframe,
        startAt,
        endAt,
        open: price.bid,
        high: price.ask,
        low: price.bid,
        close: price.ask,
        volume: '1000000',
        currency: 'USD',
        provider: this.name,
        firstSeenAt: observedAt,
        availableAt: observedAt,
        ingestedAt: observedAt,
        sourceIdentifier: `mock:${normalized}:${timeframe}:${startAt}`,
        revision: 'original',
        synthetic: true,
      }
    })
  }
}
