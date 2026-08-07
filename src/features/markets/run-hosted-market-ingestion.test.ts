import { describe, expect, it, vi } from 'vitest'

import {
  AlpacaMarketDataError,
  type AlpacaMarketDataErrorCode,
  type AlpacaMarketDataProvider,
} from '@/providers/market-data/alpaca'

import {
  runOwnerTriggeredAlpacaIngestion,
  type HostedMarketIngestionPersistence,
} from './run-hosted-market-ingestion'

const operationId = 'd4000000-0000-4000-8000-000000000001'
const request = {
  operationId,
  windowStart: '2026-08-07T12:00:00.000Z',
  windowEnd: '2026-08-07T13:00:00.000Z',
}
const symbols = ['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA']

function result(status: 'running' | 'completed' | 'failed' = 'completed') {
  return {
    operationId,
    ingestionRunId: 'd4000000-0000-4000-8000-000000000002',
    sourceId: 'd4000000-0000-4000-8000-000000000003',
    status,
    recordsSeen: 6,
    recordsInserted: 6,
    recordsReused: 0,
    recordsRejected: 0,
    finishedAt: '2026-08-07T13:00:01.000Z',
    errorClass: status === 'failed' ? 'timeout' : null,
    replayed: false,
  } as const
}

function persistence(): HostedMarketIngestionPersistence {
  return {
    begin: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        operationId,
        ingestionRunId: 'd4000000-0000-4000-8000-000000000002',
        sourceId: 'd4000000-0000-4000-8000-000000000003',
        status: 'running',
        symbols,
        replayed: false,
      },
    }),
    commit: vi.fn().mockResolvedValue({ ok: true, value: result() }),
    fail: vi.fn().mockResolvedValue({ ok: true, value: result('failed') }),
    result: vi.fn().mockResolvedValue({ ok: true, value: result() }),
  }
}

function provider() {
  return {
    getHostedLatestQuotes: vi.fn().mockResolvedValue({
      records: symbols.map((symbol) => ({
        symbol,
        bidPrice: '100.000000000001',
        askPrice: '100.010000000001',
        bidSize: '10',
        askSize: '11',
        currency: 'USD',
        provider: 'alpaca-market-data',
        providerEventAt: '2026-08-07T12:59:59.000Z',
        providerRecordKey: `${symbol}:2026-08-07T12:59:59.000Z`,
      })),
      missingSymbols: [],
      requests: [],
    }),
    getHostedCompletedMinuteBars: vi.fn().mockResolvedValue({
      records: [],
      missingSymbols: symbols,
      requests: [],
    }),
  }
}

describe('owner-triggered hosted Alpaca ingestion', () => {
  it('begins, fetches the fixed provider scope, and commits once', async () => {
    const storage = persistence()
    const dataProvider = provider()

    await expect(
      runOwnerTriggeredAlpacaIngestion({
        request,
        persistence: storage,
        provider: dataProvider as unknown as AlpacaMarketDataProvider,
        now: () => 1_000,
      }),
    ).resolves.toMatchObject({ status: 'completed' })

    expect(dataProvider.getHostedLatestQuotes).toHaveBeenCalledWith({ symbols })
    expect(dataProvider.getHostedCompletedMinuteBars).toHaveBeenCalledWith({
      symbols,
      startAt: request.windowStart,
      endAt: request.windowEnd,
      asOf: request.windowEnd,
    })
    expect(storage.commit).toHaveBeenCalledOnce()
  })

  it('never makes a second provider request for a replayed operation', async () => {
    const storage = persistence()
    vi.mocked(storage.begin).mockResolvedValue({
      ok: true,
      value: {
        operationId,
        ingestionRunId: 'd4000000-0000-4000-8000-000000000002',
        sourceId: 'd4000000-0000-4000-8000-000000000003',
        status: 'completed',
        symbols,
        replayed: true,
      },
    })
    const dataProvider = provider()

    await expect(
      runOwnerTriggeredAlpacaIngestion({
        request,
        persistence: storage,
        provider: dataProvider as unknown as AlpacaMarketDataProvider,
      }),
    ).resolves.toMatchObject({ status: 'replayed' })

    expect(dataProvider.getHostedLatestQuotes).not.toHaveBeenCalled()
    expect(storage.commit).not.toHaveBeenCalled()
  })

  it('reconciles and retries the same commit once after an unknown response', async () => {
    const storage = persistence()
    vi.mocked(storage.commit)
      .mockResolvedValueOnce({ ok: false, reason: 'unknown' })
      .mockResolvedValueOnce({ ok: true, value: result() })
    vi.mocked(storage.result).mockResolvedValue({
      ok: true,
      value: result('running'),
    })
    const dataProvider = provider()

    await expect(
      runOwnerTriggeredAlpacaIngestion({
        request,
        persistence: storage,
        provider: dataProvider as unknown as AlpacaMarketDataProvider,
        now: () => 1_000,
      }),
    ).resolves.toMatchObject({ status: 'completed' })

    expect(storage.commit).toHaveBeenCalledTimes(2)
    expect(vi.mocked(storage.commit).mock.calls[0]).toEqual(
      vi.mocked(storage.commit).mock.calls[1],
    )
    expect(dataProvider.getHostedLatestQuotes).toHaveBeenCalledOnce()
    expect(dataProvider.getHostedCompletedMinuteBars).toHaveBeenCalledOnce()
  })

  it('fails before provider access when the database scope is not exact', async () => {
    const storage = persistence()
    vi.mocked(storage.begin).mockResolvedValue({
      ok: true,
      value: {
        operationId,
        ingestionRunId: 'd4000000-0000-4000-8000-000000000002',
        sourceId: 'd4000000-0000-4000-8000-000000000003',
        status: 'running',
        symbols: ['AAPL'],
        replayed: false,
      },
    })
    const dataProvider = provider()

    await expect(
      runOwnerTriggeredAlpacaIngestion({
        request,
        persistence: storage,
        provider: dataProvider as unknown as AlpacaMarketDataProvider,
      }),
    ).resolves.toEqual({ status: 'rejected' })
    expect(dataProvider.getHostedLatestQuotes).not.toHaveBeenCalled()
  })

  it('records a sanitized provider failure and creates no commit', async () => {
    const storage = persistence()
    const dataProvider = provider()
    dataProvider.getHostedLatestQuotes.mockRejectedValue(
      new Error('credential-bearing transport detail'),
    )

    const outcome = await runOwnerTriggeredAlpacaIngestion({
      request,
      persistence: storage,
      provider: dataProvider as unknown as AlpacaMarketDataProvider,
      now: () => 2_000,
    })

    expect(outcome).toEqual({
      status: 'provider-error',
      errorClass: 'network_error',
    })
    expect(storage.fail).toHaveBeenCalledWith({
      operationId,
      errorClass: 'network_error',
      latencyMs: 0,
    })
    expect(JSON.stringify(outcome)).not.toContain('credential-bearing')
    expect(storage.commit).not.toHaveBeenCalled()
  })

  it.each([
    ['timeout', 'timeout'],
    ['network', 'network_error'],
    ['unauthorized', 'http_unauthorized'],
    ['forbidden', 'http_unauthorized'],
    ['rate_limited', 'http_rate_limited'],
    ['provider_unavailable', 'http_server_error'],
    ['provider_rejected', 'invalid_response'],
    ['redirect_refused', 'invalid_response'],
    ['response_too_large', 'invalid_response'],
    ['invalid_content_type', 'invalid_response'],
    ['invalid_payload', 'invalid_response'],
    ['pagination_exhausted', 'invalid_response'],
    ['invalid_request', 'invalid_response'],
  ] as const)(
    'maps provider %s to the database failure class %s',
    async (providerCode, expectedClass) => {
      const storage = persistence()
      const dataProvider = provider()
      dataProvider.getHostedLatestQuotes.mockRejectedValue(
        new AlpacaMarketDataError(
          providerCode as AlpacaMarketDataErrorCode,
          'latest_quotes',
        ),
      )

      await runOwnerTriggeredAlpacaIngestion({
        request,
        persistence: storage,
        provider: dataProvider as unknown as AlpacaMarketDataProvider,
      })

      expect(storage.fail).toHaveBeenCalledWith({
        operationId,
        errorClass: expectedClass,
        latencyMs: expect.any(Number),
      })
    },
  )
})
