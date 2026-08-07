import { describe, expect, it } from 'vitest'

import {
  deriveHostedMarketSessionState,
  mapHostedMarketScopeResult,
  mapHostedMarketSnapshot,
} from './hosted-market-snapshot'

const ownerId = '00000000-0000-4000-8000-000000000001'
const universeId = '10000000-0000-4000-8000-000000000001'
const instrumentId = '20000000-0000-4000-8000-000000000001'
const sourceId = '30000000-0000-4000-8000-000000000001'
const exchangeId = '40000000-0000-4000-8000-000000000001'
const decisionAt = '2026-08-07T12:00:00.000Z'

const universeRow = {
  id: universeId,
  owner_id: ownerId,
  name: 'Primary universe',
  version: 2,
  description: 'Persisted instruments',
  reviewed_manifest_id: null,
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
  active_from: '2026-01-01T00:00:00.000Z',
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
  quote_id: '50000000-0000-4000-8000-000000000001',
  quote_provider_record_key: 'quote-1',
  quote_revision_no: 2,
  quote_correction_state: 'corrected',
  bid_price_text: '9007199254740993.123456789012',
  ask_price_text: '9007199254740993.223456789012',
  bid_size_text: '100.000000000000',
  ask_size_text: '120.000000000000',
  quote_provider_event_at: '2026-08-07T11:58:00.000Z',
  quote_provider_received_at: '2026-08-07T11:58:01.000Z',
  quote_first_seen_at: '2026-08-07T11:58:01.000Z',
  quote_available_at: '2026-08-07T11:58:02.000Z',
  bar_id: '60000000-0000-4000-8000-000000000001',
  bar_provider_record_key: 'bar-1',
  bar_timeframe: '1m',
  bar_revision_no: 1,
  bar_correction_state: 'original',
  bar_start: '2026-08-07T11:58:00.000Z',
  bar_end: '2026-08-07T11:59:00.000Z',
  open_price_text: '10.000000000000',
  high_price_text: '12.000000000000',
  low_price_text: '9.000000000000',
  close_price_text: '11.000000000000',
  volume_text: '1234567890123456.123456789012',
  bar_provider_event_at: '2026-08-07T11:59:00.000Z',
  bar_provider_received_at: '2026-08-07T11:59:01.000Z',
  bar_first_seen_at: '2026-08-07T11:59:01.000Z',
  bar_available_at: '2026-08-07T11:59:02.000Z',
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
  health_id: '70000000-0000-4000-8000-000000000001',
  health_status: 'healthy',
  checked_at: '2026-08-07T11:30:00.000Z',
  last_success_at: '2026-08-07T11:29:00.000Z',
  latency_ms: 24,
  error_class: null,
  health_available_at: '2026-08-07T11:30:01.000Z',
}

const sessionRow = {
  owner_id: ownerId,
  decision_at: decisionAt,
  exchange_id: exchangeId,
  exchange_mic: 'XNAS',
  exchange_name: 'Nasdaq Stock Market',
  exchange_timezone: 'America/New_York',
  session_id: '80000000-0000-4000-8000-000000000001',
  session_date: '2026-08-07',
  opens_at: '2026-08-07T11:00:00.000Z',
  closes_at: '2026-08-07T13:00:00.000Z',
  session_type: 'regular',
  calendar_source_id: sourceId,
  calendar_source_code: 'persisted-market',
  calendar_source_name: 'Persisted market data',
  source_identifier: 'session-2026-08-07',
  session_available_at: '2026-08-06T12:00:00.000Z',
}

function map(
  overrides: {
    universeRow?: unknown | null
    memberRows?: readonly unknown[]
    sourceIds?: readonly string[]
    instrumentRows?: readonly unknown[]
    featureBarRows?: readonly unknown[]
    sessionRows?: readonly unknown[]
    healthRows?: readonly unknown[]
  } = {},
) {
  return mapHostedMarketSnapshot({
    ownerId,
    decisionAt,
    universeRow: overrides.universeRow ?? universeRow,
    memberRows: overrides.memberRows ?? [memberRow],
    sourceIds: overrides.sourceIds ?? [sourceId],
    instrumentRows: overrides.instrumentRows ?? [instrumentRow],
    featureBarRows: overrides.featureBarRows ?? [instrumentRow],
    sessionRows: overrides.sessionRows ?? [sessionRow],
    healthRows: overrides.healthRows ?? [healthRow],
  })
}

describe('mapHostedMarketSnapshot', () => {
  it('preserves exact quote and bar decimals without numeric coercion', () => {
    const snapshot = map()

    expect(snapshot.instruments[0]?.feeds[0]?.quote?.bidPrice).toBe(
      '9007199254740993.123456789012',
    )
    expect(snapshot.instruments[0]?.feeds[0]?.bar?.volume).toBe(
      '1234567890123456.123456789012',
    )
    expect(snapshot.sources[0]?.health?.status).toBe('healthy')
    expect(snapshot.instruments[0]?.feeds[0]?.features).toMatchObject({
      version: 'market-technical-v1',
      observedBarCount: 1,
      contiguousBarCount: 1,
      spreadAbsolute: '0.1',
      return1m: null,
      relativeVolume20: null,
    })
    expect(deriveHostedMarketSessionState(snapshot)).toMatchObject({
      state: 'open',
      label: 'XNAS session open',
    })
  })

  it('maps the database-attested reviewed manifest id and rejects version skew', () => {
    const snapshot = map({
      universeRow: {
        ...universeRow,
        reviewed_manifest_id: 'capital_lab_us_core_alpaca_iex_v1',
      },
    })

    expect(snapshot.universe?.reviewedManifestId).toBe(
      'capital_lab_us_core_alpaca_iex_v1',
    )
    expect(() =>
      map({
        universeRow: {
          ...universeRow,
          reviewed_manifest_id: undefined,
        },
      }),
    ).toThrow('reviewed manifest id')
    expect(() =>
      map({
        universeRow: {
          ...universeRow,
          reviewed_manifest_id: { id: 'unexpected' },
        },
      }),
    ).toThrow('reviewed manifest id')
    expect(() =>
      map({
        universeRow: {
          ...universeRow,
          reviewed_manifest_id: 'capital_lab_us_core_alpaca_iex_v2',
        },
      }),
    ).toThrow('unsupported reviewed manifest id')
  })

  it('maps a truthful empty hosted state', () => {
    const snapshot = mapHostedMarketSnapshot({
      ownerId,
      decisionAt,
      universeRow: null,
      memberRows: [],
      sourceIds: [],
      instrumentRows: [],
      featureBarRows: [],
      sessionRows: [],
      healthRows: [],
    })

    expect(snapshot.universe).toBeNull()
    expect(snapshot.instruments).toEqual([])
    expect(snapshot.sources).toEqual([])
    expect(deriveHostedMarketSessionState(snapshot).state).toBe('unavailable')
  })

  it('maps one atomic configuration scope and rejects owner drift', () => {
    expect(
      mapHostedMarketScopeResult(
        [
          {
            owner_id: ownerId,
            decision_at: decisionAt,
            universe_row: universeRow,
            member_rows: [memberRow],
            source_ids: [sourceId],
          },
        ],
        ownerId,
      ),
    ).toMatchObject({
      decisionAt,
      instrumentIds: [instrumentId],
      sourceIds: [sourceId],
    })

    expect(() =>
      mapHostedMarketScopeResult(
        [
          {
            owner_id: '00000000-0000-4000-8000-000000000099',
            decision_at: decisionAt,
            universe_row: null,
            member_rows: [],
            source_ids: [],
          },
        ],
        ownerId,
      ),
    ).toThrow('owner boundary')
  })

  it('keeps universe instruments visible without inventing a provider', () => {
    const unconfiguredRow = {
      ...instrumentRow,
      source_id: null,
      source_code: null,
      source_name: null,
      source_provider: null,
      source_type: null,
      source_is_mock: null,
      source_is_enabled: null,
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
    const snapshot = map({
      sourceIds: [],
      healthRows: [],
      instrumentRows: [unconfiguredRow],
      featureBarRows: [],
    })

    expect(snapshot.instruments[0]?.feeds).toEqual([
      {
        sourceId: null,
        quote: null,
        bar: null,
        features: {
          version: 'market-technical-v1',
          observedBarCount: 0,
          contiguousBarCount: 0,
          spreadAbsolute: null,
          spreadBps: null,
          return1m: null,
          return5m: null,
          relativeVolume20: null,
          realizedVolatility5m: null,
          distanceFromSma5: null,
          distanceFromTypicalPriceVwap20: null,
        },
      },
    ])
  })

  it('rejects a JavaScript number in an exact financial field', () => {
    expect(() =>
      map({ instrumentRows: [{ ...instrumentRow, bid_price_text: 10.25 }] }),
    ).toThrow('invalid quote bid price')
  })

  it('rejects future or partial evidence even if the database boundary regresses', () => {
    expect(() =>
      map({
        instrumentRows: [
          {
            ...instrumentRow,
            quote_available_at: '2026-08-07T12:00:01.000Z',
          },
        ],
      }),
    ).toThrow('future quote availability timestamp')

    expect(() =>
      map({
        instrumentRows: [
          {
            ...instrumentRow,
            quote_id: null,
          },
        ],
      }),
    ).toThrow('partial quote state')

    expect(() =>
      map({
        instrumentRows: [
          {
            ...instrumentRow,
            quote_provider_received_at: '2026-08-07T12:00:01.000Z',
          },
        ],
      }),
    ).toThrow('future quote provider-received timestamp')

    expect(() =>
      map({
        instrumentRows: [
          {
            ...instrumentRow,
            quote_provider_event_at: '2026-08-07T12:00:01.000Z',
          },
        ],
      }),
    ).toThrow('future quote provider timestamp')

    expect(() =>
      map({
        instrumentRows: [
          {
            ...instrumentRow,
            bar_provider_received_at: '2026-08-07T12:00:01.000Z',
          },
        ],
      }),
    ).toThrow('future bar provider-received timestamp')

    expect(() =>
      map({
        instrumentRows: [
          {
            ...instrumentRow,
            bar_provider_event_at: '2026-08-07T12:00:01.000Z',
          },
        ],
      }),
    ).toThrow('future bar provider timestamp')
  })

  it('rejects crossed quotes and invalid OHLC bars', () => {
    expect(() =>
      map({
        instrumentRows: [
          {
            ...instrumentRow,
            bid_price_text: '12',
            ask_price_text: '11',
          },
        ],
      }),
    ).toThrow('crossed quote')

    expect(() =>
      map({
        instrumentRows: [
          {
            ...instrumentRow,
            high_price_text: '10',
            close_price_text: '11',
          },
        ],
      }),
    ).toThrow('invalid OHLC bar')
  })

  it('rejects cancelled and incomplete records leaked by an RPC', () => {
    expect(() =>
      map({
        instrumentRows: [
          { ...instrumentRow, quote_correction_state: 'cancelled' },
        ],
      }),
    ).toThrow('unsupported quote correction state')

    expect(() =>
      map({
        instrumentRows: [
          { ...instrumentRow, bar_end: '2026-08-07T12:01:00.000Z' },
        ],
      }),
    ).toThrow('future bar end timestamp')

    expect(() =>
      map({
        instrumentRows: [{ ...instrumentRow, bar_timeframe: '5m' }],
      }),
    ).toThrow('unexpected bar timeframe')
  })

  it('rejects feature inputs outside the frozen feed or inconsistent with its latest bar', () => {
    expect(() =>
      map({
        featureBarRows: [
          {
            ...instrumentRow,
            source_id: '30000000-0000-4000-8000-000000000099',
          },
        ],
      }),
    ).toThrow('outside the snapshot scope')

    expect(() =>
      map({
        featureBarRows: [
          {
            ...instrumentRow,
            bar_id: '60000000-0000-4000-8000-000000000099',
          },
        ],
      }),
    ).toThrow('disagree with the current completed bar')

    expect(() =>
      map({ featureBarRows: [instrumentRow, instrumentRow] }),
    ).toThrow('duplicate feature-bar ids')
  })

  it('requires current-day calendar evidence before deriving session state', () => {
    const historical = map({
      sessionRows: [
        {
          ...sessionRow,
          session_date: '2026-08-06',
          opens_at: '2026-08-06T11:00:00.000Z',
          closes_at: '2026-08-06T13:00:00.000Z',
        },
      ],
    })
    expect(deriveHostedMarketSessionState(historical).state).toBe('unavailable')

    const currentClosed = map({
      sessionRows: [
        {
          ...sessionRow,
          opens_at: null,
          closes_at: null,
          session_type: 'closed',
        },
      ],
    })
    expect(deriveHostedMarketSessionState(currentClosed).state).toBe('closed')
  })

  it('rejects session exchange metadata that drifts from the instrument scope', () => {
    expect(() =>
      map({
        sessionRows: [{ ...sessionRow, exchange_timezone: 'Europe/Berlin' }],
      }),
    ).toThrow('inconsistent session exchange metadata')
  })

  it('rejects an invalid exchange timezone', () => {
    expect(() =>
      map({
        instrumentRows: [
          { ...instrumentRow, exchange_timezone: 'Not/A_Timezone' },
        ],
      }),
    ).toThrow('invalid exchange timezone')
  })

  it('fails closed across owner, decision-time, and source boundaries', () => {
    expect(() =>
      map({
        instrumentRows: [
          {
            ...instrumentRow,
            owner_id: '00000000-0000-4000-8000-000000000099',
          },
        ],
      }),
    ).toThrow('owner boundary')

    expect(() =>
      map({
        healthRows: [{ ...healthRow, decision_at: '2026-08-07T11:59:59.000Z' }],
      }),
    ).toThrow('inconsistent decision timestamp')

    expect(() => map({ healthRows: [] })).toThrow(
      'inconsistent source coverage',
    )
  })
})
