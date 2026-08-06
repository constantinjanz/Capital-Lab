import { describe, expect, it, vi } from 'vitest'

import { AlpacaMarketDataProvider } from './alpaca'

describe('Alpaca data-only adapter', () => {
  it('uses only the market-data origin and preserves exact numeric tokens', async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = input instanceof URL ? input : new URL(String(input))
      expect(url.origin).toBe('https://data.alpaca.markets')
      expect(url.pathname).toBe('/v2/stocks/quotes/latest')
      return new Response(
        '{"quotes":{"AAPL":{"ap":221.11000000000001,"as":120,"bp":221.08,"bs":100,"t":"2026-08-06T14:00:00.000Z"}}}',
        { status: 200 },
      )
    })
    const provider = new AlpacaMarketDataProvider({
      keyId: 'data-key',
      secretKey: 'data-secret',
      feed: 'iex',
      fetcher,
    })
    const [quote] = await provider.getLatestQuotes(
      ['AAPL'],
      '2026-08-06T14:00:01.000Z',
    )
    expect(quote).toMatchObject({
      askPrice: '221.11000000000001',
      askSize: '120',
      bidPrice: '221.08',
      synthetic: false,
    })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('derives each bar end from its own start and timeframe', async () => {
    const provider = new AlpacaMarketDataProvider({
      keyId: 'data-key',
      secretKey: 'data-secret',
      feed: 'iex',
      fetcher: async () =>
        new Response(
          '{"bars":{"AAPL":[{"t":"2026-08-06T14:00:00.000Z","o":100,"h":102,"l":99,"c":101,"v":1000}]}}',
          { status: 200 },
        ),
    })
    const [bar] = await provider.getBars(
      ['AAPL'],
      '2026-08-06T14:00:00.000Z',
      '2026-08-06T15:00:00.000Z',
      '15Min',
      '2026-08-06T15:00:01.000Z',
    )
    expect(bar.endAt).toBe('2026-08-06T14:15:00.000Z')
  })
})
