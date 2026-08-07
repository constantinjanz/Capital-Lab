import { describe, expect, it, vi } from 'vitest'

import type { AlpacaHostedRequestMetadata } from '@/providers/market-data/alpaca'

import { createHostedMarketIngestionPersistence } from './market-ingestion-write-repository'

const operationId = 'd3000000-0000-4000-8000-000000000001'
const ingestionRunId = 'd3000000-0000-4000-8000-000000000002'
const sourceId = 'd3000000-0000-4000-8000-000000000003'
const windowStart = '2026-08-06T12:00:00.000Z'
const windowEnd = '2026-08-07T12:00:00.000Z'

function commitRow(replayed = false) {
  return {
    operation_id: operationId,
    ingestion_run_id: ingestionRunId,
    source_id: sourceId,
    status: 'completed',
    records_seen: 2,
    records_inserted: 2,
    records_reused: 0,
    records_rejected: 0,
    replayed,
    finished_at: '2026-08-07T12:00:02.000Z',
  }
}

function commitInput() {
  const requests: AlpacaHostedRequestMetadata[] = [
    {
      operation: 'latest_quotes',
      page: 1,
      requestId: 'quote-request-1',
      requestedAt: '2026-08-07T12:00:00.000Z',
      receivedAt: '2026-08-07T12:00:00.100Z',
      responseBytes: 100,
      recordCount: 1,
    },
    {
      operation: 'completed_minute_bars',
      page: 1,
      requestId: 'bar-request-1',
      requestedAt: '2026-08-07T12:00:00.100Z',
      receivedAt: '2026-08-07T12:00:00.200Z',
      responseBytes: 200,
      recordCount: 1,
    },
  ]
  return {
    operationId,
    requests,
    quotes: [
      {
        symbol: 'SPY',
        bidPrice: '100.1',
        askPrice: '100.2',
        bidSize: '10',
        askSize: '12',
        currency: 'USD' as const,
        provider: 'alpaca-market-data' as const,
        providerEventAt: '2026-08-07T11:59:59.000Z',
        providerRecordKey: 'quote:SPY:2026-08-07T11:59:59.000Z',
      },
    ],
    bars: [
      {
        symbol: 'SPY',
        timeframe: '1m' as const,
        startAt: '2026-08-07T11:58:00.000Z',
        endAt: '2026-08-07T11:59:00.000Z',
        open: '100',
        high: '101',
        low: '99',
        close: '100.5',
        volume: '1000',
        currency: 'USD' as const,
        provider: 'alpaca-market-data' as const,
        providerEventAt: '2026-08-07T11:58:00.000Z',
        providerRecordKey: 'bar:SPY:2026-08-07T11:58:00.000Z',
      },
    ],
    latencyMs: 200,
  }
}

describe('hosted market ingestion write repository', () => {
  it('maps a reviewed begin RPC response', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          operation_id: operationId,
          ingestion_run_id: ingestionRunId,
          source_id: sourceId,
          status: 'running',
          symbols: ['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA'],
          window_start: windowStart,
          window_end: windowEnd,
          replayed: false,
          started_at: '2026-08-07T12:00:00.000Z',
        },
      ],
      error: null,
    })
    const repository = createHostedMarketIngestionPersistence({ rpc } as never)

    await expect(
      repository.begin({ operationId, windowStart, windowEnd }),
    ).resolves.toEqual({
      ok: true,
      value: {
        operationId,
        ingestionRunId,
        sourceId,
        status: 'running',
        symbols: ['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA'],
        replayed: false,
      },
    })
    expect(rpc).toHaveBeenCalledWith('begin_manual_hosted_market_ingestion', {
      p_operation_id: operationId,
      p_window_start: windowStart,
      p_window_end: windowEnd,
    })
  })

  it('projects only the reviewed request metadata and evidence fields on commit', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [commitRow()],
      error: null,
    })
    const repository = createHostedMarketIngestionPersistence({ rpc } as never)

    await expect(repository.commit(commitInput())).resolves.toEqual({
      ok: true,
      value: {
        operationId,
        ingestionRunId,
        sourceId,
        status: 'completed',
        recordsSeen: 2,
        recordsInserted: 2,
        recordsReused: 0,
        recordsRejected: 0,
        finishedAt: '2026-08-07T12:00:02.000Z',
        errorClass: null,
        replayed: false,
      },
    })
    expect(rpc).toHaveBeenCalledWith('commit_manual_hosted_market_ingestion', {
      p_operation_id: operationId,
      p_request_metadata: {
        feed: 'iex',
        quote_request_id: 'quote-request-1',
        bar_request_ids: ['bar-request-1'],
      },
      p_quotes: [
        {
          symbol: 'SPY',
          provider_event_at: '2026-08-07T11:59:59.000Z',
          bid_price: '100.1',
          ask_price: '100.2',
          bid_size: '10',
          ask_size: '12',
        },
      ],
      p_bars: [
        {
          symbol: 'SPY',
          bar_start: '2026-08-07T11:58:00.000Z',
          bar_end: '2026-08-07T11:59:00.000Z',
          open_price: '100',
          high_price: '101',
          low_price: '99',
          close_price: '100.5',
          volume: '1000',
        },
      ],
      p_latency_ms: 200,
    })
  })

  it.each([
    {
      label: 'missing quote request id',
      mutate: (value: ReturnType<typeof commitInput>) => {
        value.requests[0]!.requestId = null
      },
    },
    {
      label: 'missing bar request id',
      mutate: (value: ReturnType<typeof commitInput>) => {
        value.requests[1]!.requestId = null
      },
    },
    {
      label: 'multiple quote requests',
      mutate: (value: ReturnType<typeof commitInput>) => {
        value.requests.push({
          ...value.requests[0]!,
          requestId: 'quote-request-2',
        })
      },
    },
    {
      label: 'no bar request',
      mutate: (value: ReturnType<typeof commitInput>) => {
        value.requests.pop()
      },
    },
    {
      label: 'non-sequential bar page',
      mutate: (value: ReturnType<typeof commitInput>) => {
        value.requests[1]!.page = 2
      },
    },
    {
      label: 'duplicate provider request ids',
      mutate: (value: ReturnType<typeof commitInput>) => {
        value.requests[1]!.requestId = 'quote-request-1'
      },
    },
  ])('rejects $label before contacting the database', async ({ mutate }) => {
    const rpc = vi.fn()
    const repository = createHostedMarketIngestionPersistence({ rpc } as never)
    const input = commitInput()
    mutate(input)

    await expect(repository.commit(input)).resolves.toEqual({
      ok: false,
      reason: 'rejected',
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each(['22023', '23505', '23514', '42501', '55000'])(
    'maps definite SQL rejection %s without exposing detail',
    async (code) => {
      const rpc = vi.fn().mockResolvedValue({
        data: null,
        error: { code, message: 'raw database detail' },
      })
      const repository = createHostedMarketIngestionPersistence({
        rpc,
      } as never)

      await expect(repository.commit(commitInput())).resolves.toEqual({
        ok: false,
        reason: 'rejected',
      })
    },
  )

  it.each([
    { data: [], error: null },
    { data: [commitRow(), commitRow(true)], error: null },
    {
      data: [
        {
          ...commitRow(),
          operation_id: 'd3000000-0000-4000-8000-000000000999',
        },
      ],
      error: null,
    },
    { data: [{ ...commitRow(), records_seen: -1 }], error: null },
    { data: null, error: { code: 'PGRST000', message: 'transport detail' } },
  ])('maps an unconfirmed commit response to unknown', async (response) => {
    const rpc = vi.fn().mockResolvedValue(response)
    const repository = createHostedMarketIngestionPersistence({ rpc } as never)

    await expect(repository.commit(commitInput())).resolves.toEqual({
      ok: false,
      reason: 'unknown',
    })
  })
})
