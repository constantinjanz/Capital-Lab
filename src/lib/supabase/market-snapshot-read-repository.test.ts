import { afterEach, describe, expect, it, vi } from 'vitest'

const logMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/logging/logger', () => ({ log: logMock }))

import type { HostedMarketSnapshotClient } from './market-snapshot-read-repository'
import { readHostedMarketSnapshotWithClient } from './market-snapshot-read-repository'

const ownerId = '00000000-0000-4000-8000-000000000001'
const universeId = '10000000-0000-4000-8000-000000000001'
const instrumentId = '20000000-0000-4000-8000-000000000001'
const sourceId = '30000000-0000-4000-8000-000000000001'
const exchangeId = '40000000-0000-4000-8000-000000000001'
const decisionAt = '2026-08-07T12:00:00.000Z'

type QueryResult = { data: unknown; error: unknown }

const universeRow = {
  id: universeId,
  owner_id: ownerId,
  name: 'Primary universe',
  version: 1,
  description: null,
  locked_at: null,
  created_at: '2026-08-07T10:00:00.000Z',
}

const memberRow = {
  universe_id: universeId,
  owner_id: ownerId,
  instrument_id: instrumentId,
  valid_from: '2026-08-07T10:00:00.000Z',
  valid_to: null,
  created_at: '2026-08-07T10:00:00.000Z',
}

const scopeRow = {
  owner_id: ownerId,
  decision_at: decisionAt,
  universe_row: universeRow,
  member_rows: [memberRow],
  source_ids: [sourceId],
}

const instrumentRow = {
  owner_id: ownerId,
  decision_at: decisionAt,
  instrument_id: instrumentId,
  symbol: 'SAFE',
  instrument_name: 'Safe Instrument',
  asset_class: 'equity',
  currency: 'USD',
  price_increment_text: '0.010000000000',
  quantity_increment_text: '1.000000000000',
  is_tradable: true,
  is_shortable: false,
  active_from: null,
  active_to: null,
  exchange_id: exchangeId,
  exchange_mic: 'XNAS',
  exchange_name: 'Nasdaq Stock Market',
  exchange_timezone: 'America/New_York',
  source_id: sourceId,
  source_code: 'persisted-market',
  source_name: 'Persisted market data',
  source_provider: 'example',
  source_type: 'market_data',
  source_is_mock: false,
  source_is_enabled: true,
  quote_id: null,
  quote_provider_record_key: null,
  quote_revision_no: null,
  quote_correction_state: null,
  bid_price_text: null,
  ask_price_text: null,
  bid_size_text: null,
  ask_size_text: null,
  quote_provider_event_at: null,
  quote_provider_received_at: null,
  quote_first_seen_at: null,
  quote_available_at: null,
  bar_id: null,
  bar_provider_record_key: null,
  bar_timeframe: null,
  bar_revision_no: null,
  bar_correction_state: null,
  bar_start: null,
  bar_end: null,
  open_price_text: null,
  high_price_text: null,
  low_price_text: null,
  close_price_text: null,
  volume_text: null,
  bar_provider_event_at: null,
  bar_provider_received_at: null,
  bar_first_seen_at: null,
  bar_available_at: null,
}

const healthRow = {
  owner_id: ownerId,
  decision_at: decisionAt,
  source_id: sourceId,
  source_code: 'persisted-market',
  source_name: 'Persisted market data',
  source_provider: 'example',
  source_type: 'market_data',
  source_is_mock: false,
  source_is_enabled: true,
  health_id: null,
  health_status: null,
  checked_at: null,
  last_success_at: null,
  latency_ms: null,
  error_class: null,
  health_available_at: null,
}

const sessionRow = {
  owner_id: ownerId,
  decision_at: decisionAt,
  exchange_id: exchangeId,
  exchange_mic: 'XNAS',
  exchange_name: 'Nasdaq Stock Market',
  exchange_timezone: 'America/New_York',
  session_id: '50000000-0000-4000-8000-000000000001',
  session_date: '2026-08-07',
  opens_at: null,
  closes_at: null,
  session_type: 'closed',
  calendar_source_id: null,
  calendar_source_code: null,
  calendar_source_name: null,
  source_identifier: 'closed-session',
  session_available_at: '2026-08-06T12:00:00.000Z',
}

const snapshotRow = {
  ...scopeRow,
  instrument_rows: [instrumentRow],
  session_rows: [sessionRow],
  health_rows: [healthRow],
}

function clientFixture(
  options: {
    snapshotRpc?: QueryResult
    rpcThrows?: Error
  } = {},
) {
  const rpc = vi.fn(
    async (
      name: string,
      args?: Record<string, unknown>,
    ): Promise<QueryResult> => {
      void args
      if (options.rpcThrows) throw options.rpcThrows
      if (name === 'market_snapshot_read') {
        return options.snapshotRpc ?? { data: [snapshotRow], error: null }
      }
      throw new Error(`Unexpected RPC ${name}`)
    },
  )

  return {
    client: { rpc } as unknown as HostedMarketSnapshotClient,
    rpc,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('readHostedMarketSnapshotWithClient', () => {
  it('requests one atomic, bounded point-in-time database snapshot', async () => {
    const fixture = clientFixture()
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const snapshot = await readHostedMarketSnapshotWithClient(
      fixture.client,
      ownerId,
    )

    expect(snapshot.decisionAt).toBe(decisionAt)
    expect(snapshot.instruments[0]?.symbol).toBe('SAFE')
    expect(fixture.rpc).toHaveBeenCalledTimes(1)
    expect(fixture.rpc).toHaveBeenCalledWith('market_snapshot_read', {
      p_session_limit: 5,
      p_timeframe: '1m',
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns an honest empty state after database owner/time validation', async () => {
    const fixture = clientFixture({
      snapshotRpc: {
        data: [
          {
            owner_id: ownerId,
            decision_at: decisionAt,
            universe_row: null,
            member_rows: [],
            source_ids: [],
            instrument_rows: [],
            session_rows: [],
            health_rows: [],
          },
        ],
        error: null,
      },
    })

    const snapshot = await readHostedMarketSnapshotWithClient(
      fixture.client,
      ownerId,
    )

    expect(snapshot).toMatchObject({
      source: 'supabase',
      universe: null,
      sources: [],
      instruments: [],
      sessions: [],
    })
    expect(fixture.rpc).toHaveBeenCalledTimes(1)
    expect(fixture.rpc).toHaveBeenCalledWith('market_snapshot_read', {
      p_session_limit: 5,
      p_timeframe: '1m',
    })
  })

  it('sanitizes database failures at the repository boundary', async () => {
    const fixture = clientFixture({
      snapshotRpc: {
        data: null,
        error: { message: 'sensitive provider/database detail' },
      },
    })

    await expect(
      readHostedMarketSnapshotWithClient(fixture.client, ownerId),
    ).rejects.toThrow('Hosted market snapshot read failed')
    expect(logMock).toHaveBeenCalledWith(
      'error',
      'Hosted market snapshot read failed',
      {
        operation: 'snapshot_read',
        errorClass: 'HostedMarketSnapshotInternalError',
      },
    )
  })

  it('fails closed when an RPC crosses the owner boundary', async () => {
    const fixture = clientFixture({
      snapshotRpc: {
        data: [
          {
            ...snapshotRow,
            instrument_rows: [
              {
                ...instrumentRow,
                owner_id: '00000000-0000-4000-8000-000000000099',
              },
            ],
          },
        ],
        error: null,
      },
    })

    await expect(
      readHostedMarketSnapshotWithClient(fixture.client, ownerId),
    ).rejects.toThrow('Hosted market snapshot read failed')
    expect(logMock).toHaveBeenCalledWith(
      'error',
      'Hosted market snapshot read failed',
      {
        operation: 'snapshot_validation',
        errorClass: 'HostedMarketSnapshotInternalError',
      },
    )
  })

  it('classifies a thrown transport failure without logging its details', async () => {
    const fixture = clientFixture({
      rpcThrows: new Error('sensitive transport detail'),
    })

    await expect(
      readHostedMarketSnapshotWithClient(fixture.client, ownerId),
    ).rejects.toThrow('Hosted market snapshot read failed')
    expect(logMock).toHaveBeenCalledWith(
      'error',
      'Hosted market snapshot read failed',
      {
        operation: 'snapshot_read',
        errorClass: 'HostedMarketSnapshotInternalError',
      },
    )
  })
})
