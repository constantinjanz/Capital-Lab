import { describe, expect, it, vi } from 'vitest'

import {
  ALPACA_HOSTED_LIMITS,
  AlpacaMarketDataError,
  AlpacaMarketDataProvider,
  type AlpacaMarketDataOptions,
} from './alpaca'
import { parseLosslessProviderJson } from './lossless-json'

const FIXED_NOW = '2026-08-06T15:00:01.000Z'

function jsonResponse(
  body: string,
  init: ResponseInit = {},
  requestId = 'req-safe-1',
): Response {
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  headers.set('APCA-Request-ID', requestId)
  return new Response(body, { ...init, headers })
}

function provider(
  fetcher: typeof fetch,
  overrides: Partial<AlpacaMarketDataOptions> = {},
): AlpacaMarketDataProvider {
  return new AlpacaMarketDataProvider({
    keyId: 'data-key',
    secretKey: 'data-secret',
    feed: 'iex',
    fetcher,
    now: () => new Date(FIXED_NOW),
    ...overrides,
  })
}

async function rejection(
  promise: Promise<unknown>,
): Promise<AlpacaMarketDataError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(AlpacaMarketDataError)
    return error as AlpacaMarketDataError
  }
  throw new Error('Expected promise to reject')
}

describe('lossless provider JSON parsing', () => {
  it('preserves exact numeric tokens without accepting invalid JSON numbers', () => {
    expect(
      parseLosslessProviderJson(
        '{"price":221.11000000000001,"size":9007199254740993}',
      ),
    ).toEqual({
      price: '221.11000000000001',
      size: '9007199254740993',
    })
    expect(() => parseLosslessProviderJson('{"price":01}')).toThrow(
      'Invalid provider JSON',
    )
    expect(() => parseLosslessProviderJson('{"price":1,"price":2}')).toThrow(
      'Invalid provider JSON',
    )
  })
})

describe('hardened Alpaca data-only adapter', () => {
  it('uses only the latest-quote data endpoint and returns exact provider records plus request metadata', async () => {
    const fetcher = vi.fn(
      async (input: URL | RequestInfo, init?: RequestInit) => {
        const url = input instanceof URL ? input : new URL(String(input))
        expect(url.origin).toBe('https://data.alpaca.markets')
        expect(url.pathname).toBe('/v2/stocks/quotes/latest')
        expect(url.searchParams.get('symbols')).toBe('AAPL,MSFT')
        expect(url.searchParams.get('feed')).toBe('iex')
        expect(init).toMatchObject({
          method: 'GET',
          cache: 'no-store',
          redirect: 'error',
        })
        expect(new Headers(init?.headers).get('APCA-API-KEY-ID')).toBe(
          'data-key',
        )
        return jsonResponse(
          '{"quotes":{"AAPL":{"ap":221.11000000000001,"as":120,"bp":221.08,"bs":100,"t":"2026-08-06T14:00:00.000Z"}}}',
        )
      },
    )

    const batch = await provider(fetcher).getHostedLatestQuotes({
      symbols: ['MSFT', 'AAPL'],
    })

    expect(batch.records).toEqual([
      {
        symbol: 'AAPL',
        bidPrice: '221.08',
        askPrice: '221.11000000000001',
        bidSize: '100',
        askSize: '120',
        currency: 'USD',
        provider: 'alpaca-market-data',
        providerEventAt: '2026-08-06T14:00:00.000Z',
        providerRecordKey: 'AAPL:2026-08-06T14:00:00.000Z',
      },
    ])
    expect(batch.records[0]).not.toHaveProperty('id')
    expect(batch.records[0]).not.toHaveProperty('availableAt')
    expect(batch.missingSymbols).toEqual(['MSFT'])
    expect(batch.requests).toEqual([
      {
        operation: 'latest_quotes',
        page: 1,
        requestId: 'req-safe-1',
        requestedAt: FIXED_NOW,
        receivedAt: FIXED_NOW,
        responseBytes: expect.any(Number),
        recordCount: 1,
      },
    ])
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('keeps the existing provider interface compatible', async () => {
    const marketProvider = provider(async () =>
      jsonResponse(
        '{"quotes":{"AAPL":{"ap":221.11,"as":120,"bp":221.08,"bs":100,"t":"2026-08-06T14:00:00.000Z"}}}',
      ),
    )
    const [quote] = await marketProvider.getLatestQuotes(
      ['AAPL'],
      '2026-08-06T14:00:01.000Z',
    )
    expect(quote).toMatchObject({
      id: 'alpaca-quote-AAPL:2026-08-06T14:00:00.000Z',
      instrumentId: 'symbol:AAPL',
      askPrice: '221.11',
      providerReceivedAt: FIXED_NOW,
      availableAt: '2026-08-06T14:00:01.000Z',
      synthetic: false,
    })
  })

  it.each([
    { label: 'missing', symbols: undefined as never },
    { label: 'empty', symbols: [] },
    { label: 'duplicate', symbols: ['AAPL', 'AAPL'] },
    { label: 'lowercase', symbols: ['aapl'] },
    { label: 'whitespace', symbols: [' AAPL'] },
    {
      label: 'over limit',
      symbols: ['AAPL', 'MSFT', 'NVDA', 'QQQ', 'SPY', 'AMD'],
    },
  ])(
    'rejects an invalid hosted $label symbol set before fetch',
    async ({ symbols }) => {
      const fetcher = vi.fn<typeof fetch>()
      const error = await rejection(
        provider(fetcher).getHostedLatestQuotes({ symbols }),
      )
      expect(error).toMatchObject({
        code: 'invalid_request',
        operation: 'latest_quotes',
        retryable: false,
      })
      expect(fetcher).not.toHaveBeenCalled()
    },
  )

  it('requires the reviewed IEX feed for the hosted surface', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const error = await rejection(
      provider(fetcher, { feed: 'sip' }).getHostedLatestQuotes({
        symbols: ['AAPL'],
      }),
    )
    expect(error.code).toBe('invalid_request')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('requests raw as-of completed 1m bars and follows bounded pagination', async () => {
    const fetcher = vi.fn(
      async (input: URL | RequestInfo, init?: RequestInit) => {
        const url = input instanceof URL ? input : new URL(String(input))
        expect(url.origin).toBe('https://data.alpaca.markets')
        expect(url.pathname).toBe('/v2/stocks/bars')
        expect(url.searchParams.get('symbols')).toBe('AAPL,MSFT')
        expect(url.searchParams.get('timeframe')).toBe('1Min')
        expect(url.searchParams.get('adjustment')).toBe('raw')
        expect(url.searchParams.get('asof')).toBe('2026-08-06')
        expect(url.searchParams.get('sort')).toBe('asc')
        expect(url.searchParams.get('limit')).toBe('1000')
        expect(init?.redirect).toBe('error')

        if (!url.searchParams.has('page_token')) {
          return jsonResponse(
            '{"bars":{"AAPL":[{"t":"2026-08-06T14:00:00.000Z","o":100,"h":102,"l":99,"c":101,"v":1000}]},"next_page_token":"page-2"}',
            {},
            'bars-request-1',
          )
        }
        expect(url.searchParams.get('page_token')).toBe('page-2')
        return jsonResponse(
          '{"bars":{"MSFT":[{"t":"2026-08-06T14:01:00.000Z","o":200,"h":202,"l":199,"c":201,"v":2000}]},"next_page_token":null}',
          {},
          'bars-request-2',
        )
      },
    )

    const batch = await provider(fetcher).getHostedCompletedMinuteBars({
      symbols: ['MSFT', 'AAPL'],
      startAt: '2026-08-06T14:00:00.000Z',
      endAt: '2026-08-06T14:03:00.000Z',
      asOf: '2026-08-06T14:05:00.000Z',
    })

    expect(batch.records).toHaveLength(2)
    expect(batch.records[0]).toMatchObject({
      symbol: 'AAPL',
      timeframe: '1m',
      startAt: '2026-08-06T14:00:00.000Z',
      endAt: '2026-08-06T14:01:00.000Z',
      open: '100',
      providerRecordKey: 'AAPL:1m:2026-08-06T14:00:00.000Z',
    })
    expect(batch.records[0]).not.toHaveProperty('revision')
    expect(batch.records[0]).not.toHaveProperty('ingestedAt')
    expect(batch.missingSymbols).toEqual([])
    expect(batch.requests.map((request) => request.requestId)).toEqual([
      'bars-request-1',
      'bars-request-2',
    ])
    expect(batch.requests.map((request) => request.recordCount)).toEqual([1, 1])
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it.each([
    {
      startAt: '2026-08-06T14:00:00.000Z',
      endAt: '2026-08-06T14:00:00.000Z',
      asOf: '2026-08-06T15:00:00.000Z',
    },
    {
      startAt: '2026-08-06T14:00:00.000Z',
      endAt: '2026-08-06T15:00:01.000Z',
      asOf: '2026-08-06T15:00:00.000Z',
    },
    {
      startAt: '2026-08-05T13:59:59.000Z',
      endAt: '2026-08-06T14:00:00.000Z',
      asOf: '2026-08-06T15:00:00.000Z',
    },
  ])('rejects an invalid bounded bar window before fetch', async (window) => {
    const fetcher = vi.fn<typeof fetch>()
    const error = await rejection(
      provider(fetcher).getHostedCompletedMinuteBars({
        symbols: ['AAPL'],
        ...window,
      }),
    )
    expect(error.code).toBe('invalid_request')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects incomplete or out-of-window bars', async () => {
    const marketProvider = provider(async () =>
      jsonResponse(
        '{"bars":{"AAPL":[{"t":"2026-08-06T14:02:00.000Z","o":100,"h":102,"l":99,"c":101,"v":1000}]},"next_page_token":null}',
      ),
    )
    const error = await rejection(
      marketProvider.getHostedCompletedMinuteBars({
        symbols: ['AAPL'],
        startAt: '2026-08-06T14:00:00.000Z',
        endAt: '2026-08-06T14:02:30.000Z',
        asOf: '2026-08-06T14:05:00.000Z',
      }),
    )
    expect(error.code).toBe('invalid_payload')
  })

  it('rejects repeated pagination tokens', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse(
        '{"bars":{},"next_page_token":"same-token"}',
        {},
        `request-${String(fetcher.mock.calls.length)}`,
      ),
    )
    const error = await rejection(
      provider(fetcher).getHostedCompletedMinuteBars({
        symbols: ['AAPL'],
        startAt: '2026-08-06T14:00:00.000Z',
        endAt: '2026-08-06T14:01:00.000Z',
        asOf: '2026-08-06T14:02:00.000Z',
      }),
    )
    expect(error.code).toBe('pagination_exhausted')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('rejects a sixth page before issuing an unbounded request', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse(
        `{"bars":{},"next_page_token":"page-${String(fetcher.mock.calls.length + 1)}"}`,
      ),
    )
    const error = await rejection(
      provider(fetcher).getHostedCompletedMinuteBars({
        symbols: ['AAPL'],
        startAt: '2026-08-06T14:00:00.000Z',
        endAt: '2026-08-06T14:01:00.000Z',
        asOf: '2026-08-06T14:02:00.000Z',
      }),
    )
    expect(error.code).toBe('pagination_exhausted')
    expect(fetcher).toHaveBeenCalledTimes(ALPACA_HOSTED_LIMITS.maxPages)
  })

  it('enforces declared and streamed quote byte bounds', async () => {
    const declaredProvider = provider(async () =>
      jsonResponse('{"quotes":{}}', {
        headers: {
          'Content-Length': String(
            ALPACA_HOSTED_LIMITS.maxQuoteResponseBytes + 1,
          ),
        },
      }),
    )
    expect(
      (
        await rejection(
          declaredProvider.getHostedLatestQuotes({ symbols: ['AAPL'] }),
        )
      ).code,
    ).toBe('response_too_large')

    const streamedProvider = provider(async () =>
      jsonResponse(' '.repeat(ALPACA_HOSTED_LIMITS.maxQuoteResponseBytes + 1)),
    )
    expect(
      (
        await rejection(
          streamedProvider.getHostedLatestQuotes({ symbols: ['AAPL'] }),
        )
      ).code,
    ).toBe('response_too_large')
  })

  it('aborts timed-out requests with a retryable typed failure', async () => {
    const fetcher = vi.fn(
      async (_input: URL | RequestInfo, init?: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'))
          })
        }),
    )
    const error = await rejection(
      provider(fetcher, { timeoutMs: 5 }).getHostedLatestQuotes({
        symbols: ['AAPL'],
      }),
    )
    expect(error).toMatchObject({ code: 'timeout', retryable: true })
  })

  it('enforces one aggregate deadline across paginated bar requests', async () => {
    const monotonicNow = vi
      .fn<() => number>()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(11)
    const fetcher = vi.fn(async () =>
      jsonResponse(
        '{"bars":{},"next_page_token":"page-2"}',
        {},
        'bars-request-1',
      ),
    )

    const error = await rejection(
      provider(fetcher, {
        batchTimeoutMs: 10,
        monotonicNow,
      }).getHostedCompletedMinuteBars({
        symbols: ['AAPL'],
        startAt: '2026-08-06T14:00:00.000Z',
        endAt: '2026-08-06T14:01:00.000Z',
        asOf: '2026-08-06T14:02:00.000Z',
      }),
    )

    expect(error).toMatchObject({ code: 'timeout', retryable: true })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('refuses redirects without following them', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: 'https://example.com/untrusted-redirect' },
        }),
    )
    const error = await rejection(
      provider(fetcher).getHostedLatestQuotes({ symbols: ['AAPL'] }),
    )
    expect(error.code).toBe('redirect_refused')
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('classifies provider failures without leaking credentials or bodies', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse(
        '{"message":"data-secret should never escape"}',
        { status: 429 },
        'rate-limit-request',
      ),
    )
    const error = await rejection(
      provider(fetcher).getHostedLatestQuotes({ symbols: ['AAPL'] }),
    )
    expect(error).toMatchObject({
      code: 'rate_limited',
      status: 429,
      requestId: 'rate-limit-request',
      retryable: true,
    })
    expect(error.message).not.toContain('data-secret')
    expect(error.message).not.toContain('data-key')
    expect(error.message).not.toContain('message')
  })

  it('rejects unsafe request IDs, wrong content types, and malformed numerics', async () => {
    const unsafeRequestId = provider(async () =>
      jsonResponse('{"quotes":{}}', {}, 'unsafe request id with spaces'),
    )
    expect(
      (
        await rejection(
          unsafeRequestId.getHostedLatestQuotes({ symbols: ['AAPL'] }),
        )
      ).code,
    ).toBe('invalid_payload')

    const wrongContentType = provider(
      async () =>
        new Response('{"quotes":{}}', {
          headers: { 'Content-Type': 'text/plain' },
        }),
    )
    expect(
      (
        await rejection(
          wrongContentType.getHostedLatestQuotes({ symbols: ['AAPL'] }),
        )
      ).code,
    ).toBe('invalid_content_type')

    const malformedNumeric = provider(async () =>
      jsonResponse(
        '{"quotes":{"AAPL":{"ap":01,"as":120,"bp":1,"bs":100,"t":"2026-08-06T14:00:00.000Z"}}}',
      ),
    )
    expect(
      (
        await rejection(
          malformedNumeric.getHostedLatestQuotes({ symbols: ['AAPL'] }),
        )
      ).code,
    ).toBe('invalid_payload')
  })

  it('rejects unrequested symbols and invalid financial invariants', async () => {
    const unrequested = provider(async () =>
      jsonResponse(
        '{"quotes":{"MSFT":{"ap":221.11,"as":120,"bp":221.08,"bs":100,"t":"2026-08-06T14:00:00.000Z"}}}',
      ),
    )
    expect(
      (
        await rejection(
          unrequested.getHostedLatestQuotes({ symbols: ['AAPL'] }),
        )
      ).code,
    ).toBe('invalid_payload')

    const crossedQuote = provider(async () =>
      jsonResponse(
        '{"quotes":{"AAPL":{"ap":220,"as":120,"bp":221,"bs":100,"t":"2026-08-06T14:00:00.000Z"}}}',
      ),
    )
    expect(
      (
        await rejection(
          crossedQuote.getHostedLatestQuotes({ symbols: ['AAPL'] }),
        )
      ).code,
    ).toBe('invalid_payload')

    const invalidBar = provider(async () =>
      jsonResponse(
        '{"bars":{"AAPL":[{"t":"2026-08-06T14:00:00.000Z","o":100,"h":99,"l":98,"c":101,"v":1000}]},"next_page_token":null}',
      ),
    )
    expect(
      (
        await rejection(
          invalidBar.getHostedCompletedMinuteBars({
            symbols: ['AAPL'],
            startAt: '2026-08-06T14:00:00.000Z',
            endAt: '2026-08-06T14:01:00.000Z',
            asOf: '2026-08-06T14:02:00.000Z',
          }),
        )
      ).code,
    ).toBe('invalid_payload')
  })

  it('maps completed 1m bars through the legacy provider interface', async () => {
    const marketProvider = provider(async () =>
      jsonResponse(
        '{"bars":{"AAPL":[{"t":"2026-08-06T14:00:00.000Z","o":100,"h":102,"l":99,"c":101,"v":1000}]},"next_page_token":null}',
      ),
    )
    const [bar] = await marketProvider.getBars(
      ['AAPL'],
      '2026-08-06T14:00:00.000Z',
      '2026-08-06T14:01:00.000Z',
      '1m',
      '2026-08-06T14:02:00.000Z',
    )
    expect(bar).toMatchObject({
      timeframe: '1m',
      startAt: '2026-08-06T14:00:00.000Z',
      endAt: '2026-08-06T14:01:00.000Z',
      providerEventAt: '2026-08-06T14:00:00.000Z',
      providerReceivedAt: FIXED_NOW,
    })
  })
})
