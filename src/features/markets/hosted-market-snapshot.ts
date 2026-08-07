import {
  decimal,
  requireNonNegative,
  requirePositive,
} from '@/domain/financial/decimal'
import type { Tone } from '@/lib/mock/types'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
export const REVIEWED_HOSTED_MARKET_MANIFEST_ID =
  'capital_lab_us_core_alpaca_iex_v1' as const

const assetClasses = new Set([
  'equity',
  'etf',
  'option',
  'future',
  'crypto',
  'fx',
])
const sourceTypes = new Set(['market_data', 'mock'])
const correctionStates = new Set(['original', 'corrected'])
const barTimeframes = new Set(['1m', '5m', '15m', '1h', '1d'])
const sessionTypes = new Set(['regular', 'early_close', 'closed'])
const healthStatuses = new Set([
  'healthy',
  'degraded',
  'unavailable',
  'disabled',
])

type UnknownRow = Record<string, unknown>

export interface HostedMarketUniverse {
  id: string
  name: string
  version: number
  description: string | null
  reviewedManifestId: typeof REVIEWED_HOSTED_MARKET_MANIFEST_ID | null
  lockedAt: string | null
  createdAt: string
  instrumentIds: string[]
}

export interface HostedMarketSource {
  id: string
  code: string
  name: string
  provider: string
  sourceType: 'market_data' | 'mock'
  isMock: boolean
  isEnabled: boolean
  health: {
    id: string
    status: 'healthy' | 'degraded' | 'unavailable' | 'disabled'
    checkedAt: string
    lastSuccessAt: string | null
    latencyMs: number | null
    errorClass: string | null
    availableAt: string
  } | null
}

export interface HostedMarketQuote {
  id: string
  providerRecordKey: string
  revisionNo: number
  correctionState: 'original' | 'corrected'
  bidPrice: string | null
  askPrice: string | null
  bidSize: string | null
  askSize: string | null
  providerEventAt: string
  providerReceivedAt: string | null
  firstSeenAt: string
  availableAt: string
}

export interface HostedMarketBar {
  id: string
  providerRecordKey: string
  timeframe: '1m'
  revisionNo: number
  correctionState: 'original' | 'corrected'
  startsAt: string
  endsAt: string
  openPrice: string
  highPrice: string
  lowPrice: string
  closePrice: string
  volume: string
  providerEventAt: string
  providerReceivedAt: string | null
  firstSeenAt: string
  availableAt: string
}

export interface HostedMarketInstrumentFeed {
  sourceId: string | null
  quote: HostedMarketQuote | null
  bar: HostedMarketBar | null
}

export interface HostedMarketInstrument {
  id: string
  symbol: string
  name: string
  assetClass: string
  currency: string
  priceIncrement: string
  quantityIncrement: string
  isTradable: boolean
  isShortable: boolean
  activeFrom: string | null
  activeTo: string | null
  exchange: {
    id: string
    mic: string
    name: string
    timezone: string
  }
  feeds: HostedMarketInstrumentFeed[]
}

export interface HostedMarketSession {
  id: string
  exchangeId: string
  exchangeMic: string
  exchangeName: string
  exchangeTimezone: string
  sessionDate: string
  opensAt: string | null
  closesAt: string | null
  sessionType: 'regular' | 'early_close' | 'closed'
  calendarSourceId: string | null
  calendarSourceCode: string | null
  calendarSourceName: string | null
  sourceIdentifier: string
  availableAt: string
}

export interface HostedMarketSnapshot {
  source: 'supabase'
  decisionAt: string
  timeframe: '1m'
  universe: HostedMarketUniverse | null
  sources: HostedMarketSource[]
  instruments: HostedMarketInstrument[]
  sessions: HostedMarketSession[]
}

export interface HostedMarketSessionState {
  state: 'open' | 'scheduled' | 'closed' | 'unavailable'
  label: string
  detail: string
  tone: Tone
}

function row(value: unknown, label: string): UnknownRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Hosted market snapshot has an invalid ${label}`)
  }
  return value as UnknownRow
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Hosted market snapshot has an invalid ${label}`)
  }
  return value
}

function nullableText(value: unknown, label: string): string | null {
  return value === null ? null : text(value, label)
}

function reviewedManifestId(
  value: unknown,
): typeof REVIEWED_HOSTED_MARKET_MANIFEST_ID | null {
  if (value === null) return null
  if (
    text(value, 'reviewed manifest id') !== REVIEWED_HOSTED_MARKET_MANIFEST_ID
  ) {
    throw new Error(
      'Hosted market snapshot has an unsupported reviewed manifest id',
    )
  }
  return REVIEWED_HOSTED_MARKET_MANIFEST_ID
}

function uuid(value: unknown, label: string): string {
  const result = text(value, label)
  if (!UUID_PATTERN.test(result)) {
    throw new Error(`Hosted market snapshot has an invalid ${label}`)
  }
  return result
}

function nullableUuid(value: unknown, label: string): string | null {
  return value === null ? null : uuid(value, label)
}

function timestamp(value: unknown, label: string): string {
  const result = text(value, label)
  if (!Number.isFinite(Date.parse(result))) {
    throw new Error(`Hosted market snapshot has an invalid ${label}`)
  }
  return result
}

function nullableTimestamp(value: unknown, label: string): string | null {
  return value === null ? null : timestamp(value, label)
}

function timezone(value: unknown, label: string): string {
  const result = text(value, label)
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: result }).format(0)
  } catch {
    throw new Error(`Hosted market snapshot has an invalid ${label}`)
  }
  return result
}

function dateInTimezone(value: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value))
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value
  const year = part('year')
  const month = part('month')
  const day = part('day')
  if (!year || !month || !day) {
    throw new Error('Hosted market snapshot cannot resolve a local date')
  }
  return `${year}-${month}-${day}`
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`Hosted market snapshot has an invalid ${label}`)
  }
  return value
}

function integer(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new Error(`Hosted market snapshot has an invalid ${label}`)
  }
  return value as number
}

function nullableInteger(
  value: unknown,
  label: string,
  minimum = 0,
): number | null {
  return value === null ? null : integer(value, label, minimum)
}

function exactPositive(value: unknown, label: string): string {
  const result = text(value, label)
  requirePositive(result, label)
  return result
}

function exactNonNegative(value: unknown, label: string): string {
  const result = text(value, label)
  requireNonNegative(result, label)
  return result
}

function nullableExactNonNegative(
  value: unknown,
  label: string,
): string | null {
  return value === null ? null : exactNonNegative(value, label)
}

function assertAtOrBefore(value: string, upperBound: string, label: string) {
  if (Date.parse(value) > Date.parse(upperBound)) {
    throw new Error(`Hosted market snapshot has a future ${label}`)
  }
}

function assertBefore(value: string, upperBound: string, label: string) {
  if (Date.parse(value) >= Date.parse(upperBound)) {
    throw new Error(`Hosted market snapshot has an invalid ${label}`)
  }
}

function assertSameInstant(
  value: unknown,
  expected: string,
  label = 'decision timestamp',
) {
  const result = timestamp(value, label)
  if (Date.parse(result) !== Date.parse(expected)) {
    throw new Error(`Hosted market snapshot has an inconsistent ${label}`)
  }
}

function assertNullFields(
  source: UnknownRow,
  fields: readonly string[],
  label: string,
) {
  if (fields.some((field) => source[field] !== null)) {
    throw new Error(`Hosted market snapshot has partial ${label}`)
  }
}

function enumValue<T extends string>(
  value: unknown,
  values: ReadonlySet<string>,
  label: string,
): T {
  const result = text(value, label)
  if (!values.has(result)) {
    throw new Error(`Hosted market snapshot has an unsupported ${label}`)
  }
  return result as T
}

function mapQuote(
  source: UnknownRow,
  decisionAt: string,
  hasSource: boolean,
): HostedMarketQuote | null {
  const id = nullableUuid(source.quote_id, 'quote id')
  const fields = [
    'quote_provider_record_key',
    'quote_revision_no',
    'quote_correction_state',
    'bid_price_text',
    'ask_price_text',
    'bid_size_text',
    'ask_size_text',
    'quote_provider_event_at',
    'quote_provider_received_at',
    'quote_first_seen_at',
    'quote_available_at',
  ] as const
  if (id === null) {
    assertNullFields(source, fields, 'quote state')
    return null
  }
  if (!hasSource) {
    throw new Error('Hosted market snapshot has a quote without a source')
  }

  const bidPrice = nullableExactNonNegative(
    source.bid_price_text,
    'quote bid price',
  )
  const askPrice = nullableExactNonNegative(
    source.ask_price_text,
    'quote ask price',
  )
  if (bidPrice === null && askPrice === null) {
    throw new Error('Hosted market snapshot has a quote without a price')
  }
  if (
    bidPrice !== null &&
    askPrice !== null &&
    decimal(askPrice).lt(bidPrice)
  ) {
    throw new Error('Hosted market snapshot has a crossed quote')
  }

  const providerEventAt = timestamp(
    source.quote_provider_event_at,
    'quote provider timestamp',
  )
  const firstSeenAt = timestamp(
    source.quote_first_seen_at,
    'quote first-seen timestamp',
  )
  const availableAt = timestamp(
    source.quote_available_at,
    'quote availability timestamp',
  )
  assertAtOrBefore(providerEventAt, decisionAt, 'quote provider timestamp')
  assertAtOrBefore(availableAt, decisionAt, 'quote availability timestamp')
  assertAtOrBefore(firstSeenAt, availableAt, 'quote first-seen timestamp')
  const providerReceivedAt = nullableTimestamp(
    source.quote_provider_received_at,
    'quote provider-received timestamp',
  )
  if (providerReceivedAt !== null) {
    assertAtOrBefore(
      providerReceivedAt,
      decisionAt,
      'quote provider-received timestamp',
    )
    assertAtOrBefore(
      providerReceivedAt,
      availableAt,
      'quote provider-received timestamp',
    )
  }

  return {
    id,
    providerRecordKey: text(
      source.quote_provider_record_key,
      'quote provider record key',
    ),
    revisionNo: integer(source.quote_revision_no, 'quote revision', 1),
    correctionState: enumValue(
      source.quote_correction_state,
      correctionStates,
      'quote correction state',
    ),
    bidPrice,
    askPrice,
    bidSize: nullableExactNonNegative(source.bid_size_text, 'quote bid size'),
    askSize: nullableExactNonNegative(source.ask_size_text, 'quote ask size'),
    providerEventAt,
    providerReceivedAt,
    firstSeenAt,
    availableAt,
  }
}

function mapBar(
  source: UnknownRow,
  decisionAt: string,
  hasSource: boolean,
): HostedMarketBar | null {
  const id = nullableUuid(source.bar_id, 'bar id')
  const fields = [
    'bar_provider_record_key',
    'bar_timeframe',
    'bar_revision_no',
    'bar_correction_state',
    'bar_start',
    'bar_end',
    'open_price_text',
    'high_price_text',
    'low_price_text',
    'close_price_text',
    'volume_text',
    'bar_provider_event_at',
    'bar_provider_received_at',
    'bar_first_seen_at',
    'bar_available_at',
  ] as const
  if (id === null) {
    assertNullFields(source, fields, 'bar state')
    return null
  }
  if (!hasSource) {
    throw new Error('Hosted market snapshot has a bar without a source')
  }

  const startsAt = timestamp(source.bar_start, 'bar start timestamp')
  const endsAt = timestamp(source.bar_end, 'bar end timestamp')
  const providerEventAt = timestamp(
    source.bar_provider_event_at,
    'bar provider timestamp',
  )
  const firstSeenAt = timestamp(
    source.bar_first_seen_at,
    'bar first-seen timestamp',
  )
  const availableAt = timestamp(
    source.bar_available_at,
    'bar availability timestamp',
  )
  assertBefore(startsAt, endsAt, 'bar window')
  assertAtOrBefore(endsAt, decisionAt, 'bar end timestamp')
  assertAtOrBefore(providerEventAt, decisionAt, 'bar provider timestamp')
  assertAtOrBefore(availableAt, decisionAt, 'bar availability timestamp')
  assertAtOrBefore(firstSeenAt, availableAt, 'bar first-seen timestamp')
  const providerReceivedAt = nullableTimestamp(
    source.bar_provider_received_at,
    'bar provider-received timestamp',
  )
  if (providerReceivedAt !== null) {
    assertAtOrBefore(
      providerReceivedAt,
      decisionAt,
      'bar provider-received timestamp',
    )
    assertAtOrBefore(
      providerReceivedAt,
      availableAt,
      'bar provider-received timestamp',
    )
  }

  const timeframe = enumValue<HostedMarketBar['timeframe']>(
    source.bar_timeframe,
    barTimeframes,
    'bar timeframe',
  )
  if (timeframe !== '1m') {
    throw new Error('Hosted market snapshot has an unexpected bar timeframe')
  }

  const openPrice = exactNonNegative(source.open_price_text, 'bar open price')
  const highPrice = exactNonNegative(source.high_price_text, 'bar high price')
  const lowPrice = exactNonNegative(source.low_price_text, 'bar low price')
  const closePrice = exactNonNegative(
    source.close_price_text,
    'bar close price',
  )
  const high = decimal(highPrice)
  const low = decimal(lowPrice)
  if (
    high.lt(openPrice) ||
    high.lt(lowPrice) ||
    high.lt(closePrice) ||
    low.gt(openPrice) ||
    low.gt(highPrice) ||
    low.gt(closePrice)
  ) {
    throw new Error('Hosted market snapshot has an invalid OHLC bar')
  }

  return {
    id,
    providerRecordKey: text(
      source.bar_provider_record_key,
      'bar provider record key',
    ),
    timeframe,
    revisionNo: integer(source.bar_revision_no, 'bar revision', 1),
    correctionState: enumValue(
      source.bar_correction_state,
      correctionStates,
      'bar correction state',
    ),
    startsAt,
    endsAt,
    openPrice,
    highPrice,
    lowPrice,
    closePrice,
    volume: exactNonNegative(source.volume_text, 'bar volume'),
    providerEventAt,
    providerReceivedAt,
    firstSeenAt,
    availableAt,
  }
}

function mapInstrumentRow(
  value: unknown,
  ownerId: string,
  decisionAt: string,
): {
  instrument: Omit<HostedMarketInstrument, 'feeds'>
  source: Omit<HostedMarketSource, 'health'> | null
  feed: HostedMarketInstrumentFeed
} {
  const source = row(value, 'instrument row')
  if (uuid(source.owner_id, 'row owner id') !== ownerId) {
    throw new Error('Hosted market snapshot crossed its owner boundary')
  }
  assertSameInstant(source.decision_at, decisionAt)

  const sourceId = nullableUuid(source.source_id, 'source id')
  const sourceFields = [
    'source_code',
    'source_name',
    'source_provider',
    'source_type',
    'source_is_mock',
    'source_is_enabled',
  ] as const
  let mappedSource: Omit<HostedMarketSource, 'health'> | null = null
  if (sourceId === null) {
    assertNullFields(source, sourceFields, 'source state')
  } else {
    mappedSource = {
      id: sourceId,
      code: text(source.source_code, 'source code'),
      name: text(source.source_name, 'source name'),
      provider: text(source.source_provider, 'source provider'),
      sourceType: enumValue(source.source_type, sourceTypes, 'source type'),
      isMock: boolean(source.source_is_mock, 'source mock flag'),
      isEnabled: boolean(source.source_is_enabled, 'source enabled flag'),
    }
  }

  const activeFrom = nullableTimestamp(
    source.active_from,
    'instrument active-from timestamp',
  )
  const activeTo = nullableTimestamp(
    source.active_to,
    'instrument active-to timestamp',
  )
  if (activeFrom !== null && activeTo !== null) {
    assertBefore(activeFrom, activeTo, 'instrument active window')
  }

  return {
    instrument: {
      id: uuid(source.instrument_id, 'instrument id'),
      symbol: text(source.symbol, 'instrument symbol'),
      name: text(source.instrument_name, 'instrument name'),
      assetClass: enumValue(
        source.asset_class,
        assetClasses,
        'instrument asset class',
      ),
      currency: text(source.currency, 'instrument currency'),
      priceIncrement: exactPositive(
        source.price_increment_text,
        'price increment',
      ),
      quantityIncrement: exactPositive(
        source.quantity_increment_text,
        'quantity increment',
      ),
      isTradable: boolean(source.is_tradable, 'tradable flag'),
      isShortable: boolean(source.is_shortable, 'shortable flag'),
      activeFrom,
      activeTo,
      exchange: {
        id: uuid(source.exchange_id, 'exchange id'),
        mic: text(source.exchange_mic, 'exchange MIC'),
        name: text(source.exchange_name, 'exchange name'),
        timezone: timezone(source.exchange_timezone, 'exchange timezone'),
      },
    },
    source: mappedSource,
    feed: {
      sourceId,
      quote: mapQuote(source, decisionAt, sourceId !== null),
      bar: mapBar(source, decisionAt, sourceId !== null),
    },
  }
}

function mapUniverse(
  universeValue: unknown | null,
  memberValues: readonly unknown[],
  ownerId: string,
  decisionAt: string,
): HostedMarketUniverse | null {
  if (universeValue === null) {
    if (memberValues.length > 0) {
      throw new Error('Hosted market snapshot has members without a universe')
    }
    return null
  }

  const universe = row(universeValue, 'universe row')
  const universeId = uuid(universe.id, 'universe id')
  if (uuid(universe.owner_id, 'universe owner id') !== ownerId) {
    throw new Error('Hosted market universe crossed its owner boundary')
  }
  const createdAt = timestamp(
    universe.created_at,
    'universe creation timestamp',
  )
  assertAtOrBefore(createdAt, decisionAt, 'universe creation timestamp')

  const instrumentIds = memberValues.map((value) => {
    const member = row(value, 'universe member row')
    if (
      uuid(member.owner_id, 'universe member owner id') !== ownerId ||
      uuid(member.universe_id, 'member universe id') !== universeId
    ) {
      throw new Error('Hosted market member crossed its universe boundary')
    }
    const validFrom = timestamp(
      member.valid_from,
      'member valid-from timestamp',
    )
    const validTo = nullableTimestamp(
      member.valid_to,
      'member valid-to timestamp',
    )
    const memberCreatedAt = timestamp(
      member.created_at,
      'member creation timestamp',
    )
    assertAtOrBefore(validFrom, decisionAt, 'member valid-from timestamp')
    assertAtOrBefore(memberCreatedAt, decisionAt, 'member creation timestamp')
    if (validTo !== null && Date.parse(validTo) <= Date.parse(decisionAt)) {
      throw new Error('Hosted market snapshot contains an expired member')
    }
    return uuid(member.instrument_id, 'member instrument id')
  })
  if (new Set(instrumentIds).size !== instrumentIds.length) {
    throw new Error('Hosted market snapshot has duplicate universe members')
  }
  if (instrumentIds.length > 100) {
    throw new Error('Hosted market universe exceeds the snapshot limit')
  }

  return {
    id: universeId,
    name: text(universe.name, 'universe name'),
    version: integer(universe.version, 'universe version', 1),
    description: nullableText(universe.description, 'universe description'),
    reviewedManifestId: reviewedManifestId(universe.reviewed_manifest_id),
    lockedAt: nullableTimestamp(universe.locked_at, 'universe lock timestamp'),
    createdAt,
    instrumentIds: instrumentIds.toSorted(),
  }
}

function sameSource(
  left: Omit<HostedMarketSource, 'health'>,
  right: Omit<HostedMarketSource, 'health'>,
) {
  return (
    left.id === right.id &&
    left.code === right.code &&
    left.name === right.name &&
    left.provider === right.provider &&
    left.sourceType === right.sourceType &&
    left.isMock === right.isMock &&
    left.isEnabled === right.isEnabled
  )
}

function mapSources(
  values: readonly unknown[],
  ownerId: string,
  decisionAt: string,
  expectedSourceIds: readonly string[],
): HostedMarketSource[] {
  const sources = values.map((value) => {
    const source = row(value, 'source-health row')
    if (uuid(source.owner_id, 'source-health owner id') !== ownerId) {
      throw new Error('Hosted source health crossed its owner boundary')
    }
    assertSameInstant(source.decision_at, decisionAt)
    const mappedSource: HostedMarketSource = {
      id: uuid(source.source_id, 'health source id'),
      code: text(source.source_code, 'health source code'),
      name: text(source.source_name, 'health source name'),
      provider: text(source.source_provider, 'health source provider'),
      sourceType: enumValue(
        source.source_type,
        sourceTypes,
        'health source type',
      ),
      isMock: boolean(source.source_is_mock, 'health source mock flag'),
      isEnabled: boolean(
        source.source_is_enabled,
        'health source enabled flag',
      ),
      health: null,
    }

    const healthId = nullableUuid(source.health_id, 'source health id')
    const healthFields = [
      'health_status',
      'checked_at',
      'last_success_at',
      'latency_ms',
      'error_class',
      'health_available_at',
    ] as const
    if (healthId === null) {
      assertNullFields(source, healthFields, 'source-health state')
      return mappedSource
    }

    const checkedAt = timestamp(source.checked_at, 'health check timestamp')
    const availableAt = timestamp(
      source.health_available_at,
      'health availability timestamp',
    )
    const lastSuccessAt = nullableTimestamp(
      source.last_success_at,
      'health last-success timestamp',
    )
    assertAtOrBefore(checkedAt, decisionAt, 'health check timestamp')
    assertAtOrBefore(availableAt, decisionAt, 'health availability timestamp')
    if (lastSuccessAt !== null) {
      assertAtOrBefore(
        lastSuccessAt,
        decisionAt,
        'health last-success timestamp',
      )
    }
    mappedSource.health = {
      id: healthId,
      status: enumValue(
        source.health_status,
        healthStatuses,
        'source health status',
      ),
      checkedAt,
      lastSuccessAt,
      latencyMs: nullableInteger(source.latency_ms, 'source latency'),
      errorClass: nullableText(source.error_class, 'source error class'),
      availableAt,
    }
    return mappedSource
  })

  const actualIds = sources.map((source) => source.id).toSorted()
  const expectedIds = [...expectedSourceIds].toSorted()
  if (
    actualIds.length !== expectedIds.length ||
    actualIds.some((id, index) => id !== expectedIds[index])
  ) {
    throw new Error('Hosted market snapshot has inconsistent source coverage')
  }
  return sources.toSorted((left, right) => left.code.localeCompare(right.code))
}

function mapInstruments(
  values: readonly unknown[],
  ownerId: string,
  decisionAt: string,
  expectedInstrumentIds: readonly string[],
  expectedSources: readonly HostedMarketSource[],
): HostedMarketInstrument[] {
  const instruments = new Map<string, HostedMarketInstrument>()
  const sourceIds = expectedSources.map((source) => source.id).toSorted()
  const expectedSourcesById = new Map(
    expectedSources.map((source) => [source.id, source]),
  )

  for (const value of values) {
    const mapped = mapInstrumentRow(value, ownerId, decisionAt)
    const existing = instruments.get(mapped.instrument.id)
    if (!existing) {
      instruments.set(mapped.instrument.id, {
        ...mapped.instrument,
        feeds: [mapped.feed],
      })
    } else {
      if (
        JSON.stringify(existing) !==
        JSON.stringify({ ...mapped.instrument, feeds: existing.feeds })
      ) {
        throw new Error(
          'Hosted market snapshot has inconsistent instrument metadata',
        )
      }
      if (
        existing.feeds.some((feed) => feed.sourceId === mapped.feed.sourceId)
      ) {
        throw new Error('Hosted market snapshot has duplicate instrument feeds')
      }
      existing.feeds.push(mapped.feed)
    }

    if (mapped.source !== null) {
      const expectedSource = expectedSourcesById.get(mapped.source.id)
      if (!expectedSource || !sameSource(mapped.source, expectedSource)) {
        throw new Error(
          'Hosted market snapshot has inconsistent source metadata',
        )
      }
    }
  }

  const actualInstrumentIds = [...instruments.keys()].toSorted()
  const expectedIds = [...expectedInstrumentIds].toSorted()
  if (
    actualInstrumentIds.length !== expectedIds.length ||
    actualInstrumentIds.some((id, index) => id !== expectedIds[index])
  ) {
    throw new Error(
      'Hosted market snapshot has inconsistent instrument coverage',
    )
  }

  for (const instrument of instruments.values()) {
    const actualSourceIds = instrument.feeds
      .map((feed) => feed.sourceId)
      .filter((sourceId): sourceId is string => sourceId !== null)
      .toSorted()
    if (sourceIds.length === 0) {
      if (
        instrument.feeds.length !== 1 ||
        instrument.feeds[0]?.sourceId !== null
      ) {
        throw new Error('Hosted market snapshot has invalid unconfigured feeds')
      }
    } else if (
      actualSourceIds.length !== sourceIds.length ||
      actualSourceIds.some((id, index) => id !== sourceIds[index])
    ) {
      throw new Error('Hosted market snapshot has incomplete provider coverage')
    }
    instrument.feeds.sort((left, right) =>
      (left.sourceId ?? '').localeCompare(right.sourceId ?? ''),
    )
  }

  return [...instruments.values()].toSorted((left, right) =>
    left.symbol.localeCompare(right.symbol),
  )
}

function mapSessions(
  values: readonly unknown[],
  ownerId: string,
  decisionAt: string,
  exchanges: ReadonlyMap<string, HostedMarketInstrument['exchange']>,
): HostedMarketSession[] {
  const seen = new Set<string>()
  return values.map((value) => {
    const session = row(value, 'session row')
    if (uuid(session.owner_id, 'session owner id') !== ownerId) {
      throw new Error('Hosted market session crossed its owner boundary')
    }
    assertSameInstant(session.decision_at, decisionAt)
    const id = uuid(session.session_id, 'session id')
    if (seen.has(id)) {
      throw new Error('Hosted market snapshot has duplicate sessions')
    }
    seen.add(id)
    const exchangeId = uuid(session.exchange_id, 'session exchange id')
    const expectedExchange = exchanges.get(exchangeId)
    if (!expectedExchange) {
      throw new Error(
        'Hosted market snapshot has a session outside its universe',
      )
    }
    const exchangeMic = text(session.exchange_mic, 'session exchange MIC')
    const exchangeName = text(session.exchange_name, 'session exchange name')
    const exchangeTimezone = timezone(
      session.exchange_timezone,
      'session exchange timezone',
    )
    if (
      exchangeMic !== expectedExchange.mic ||
      exchangeName !== expectedExchange.name ||
      exchangeTimezone !== expectedExchange.timezone
    ) {
      throw new Error(
        'Hosted market snapshot has inconsistent session exchange metadata',
      )
    }
    const sessionDate = text(session.session_date, 'session date')
    if (
      !DATE_PATTERN.test(sessionDate) ||
      !Number.isFinite(Date.parse(`${sessionDate}T00:00:00Z`))
    ) {
      throw new Error('Hosted market snapshot has an invalid session date')
    }
    const sessionType = enumValue<HostedMarketSession['sessionType']>(
      session.session_type,
      sessionTypes,
      'session type',
    )
    const opensAt = nullableTimestamp(
      session.opens_at,
      'session open timestamp',
    )
    const closesAt = nullableTimestamp(
      session.closes_at,
      'session close timestamp',
    )
    if (sessionType === 'closed') {
      if (opensAt !== null || closesAt !== null) {
        throw new Error('Hosted market snapshot has an invalid closed session')
      }
    } else if (opensAt === null || closesAt === null) {
      throw new Error('Hosted market snapshot has a partial session window')
    } else {
      assertBefore(opensAt, closesAt, 'session window')
    }
    const availableAt = timestamp(
      session.session_available_at,
      'session availability timestamp',
    )
    assertAtOrBefore(availableAt, decisionAt, 'session availability timestamp')
    const calendarSourceId = nullableUuid(
      session.calendar_source_id,
      'calendar source id',
    )
    const calendarSourceCode = nullableText(
      session.calendar_source_code,
      'calendar source code',
    )
    const calendarSourceName = nullableText(
      session.calendar_source_name,
      'calendar source name',
    )
    if (
      (calendarSourceId === null &&
        (calendarSourceCode !== null || calendarSourceName !== null)) ||
      (calendarSourceId !== null &&
        (calendarSourceCode === null || calendarSourceName === null))
    ) {
      throw new Error(
        'Hosted market snapshot has inconsistent calendar-source metadata',
      )
    }

    return {
      id,
      exchangeId,
      exchangeMic,
      exchangeName,
      exchangeTimezone,
      sessionDate,
      opensAt,
      closesAt,
      sessionType,
      calendarSourceId,
      calendarSourceCode,
      calendarSourceName,
      sourceIdentifier: text(
        session.source_identifier,
        'session source identifier',
      ),
      availableAt,
    }
  })
}

export function extractHostedMarketExchangeIds(
  values: readonly unknown[],
  ownerId: string,
  decisionAt: string,
): string[] {
  const ids = new Set<string>()
  for (const value of values) {
    const source = row(value, 'instrument row')
    if (uuid(source.owner_id, 'row owner id') !== ownerId) {
      throw new Error('Hosted market snapshot crossed its owner boundary')
    }
    assertSameInstant(source.decision_at, decisionAt)
    ids.add(uuid(source.exchange_id, 'exchange id'))
  }
  if (ids.size > 25) {
    throw new Error('Hosted market snapshot exceeds the exchange limit')
  }
  return [...ids].toSorted()
}

export function mapHostedMarketScopeResult(
  value: unknown,
  expectedOwnerId: string,
): {
  decisionAt: string
  universeRow: unknown | null
  memberRows: readonly unknown[]
  instrumentIds: string[]
  sourceIds: string[]
} {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new Error('Hosted market snapshot has an invalid configuration scope')
  }
  const scope = row(value[0], 'configuration scope')
  const ownerId = uuid(expectedOwnerId, 'requested owner id')
  if (uuid(scope.owner_id, 'scope owner id') !== ownerId) {
    throw new Error('Hosted market scope crossed its owner boundary')
  }
  const memberRows = scope.member_rows
  const sourceIdValues = scope.source_ids
  if (!Array.isArray(memberRows) || !Array.isArray(sourceIdValues)) {
    throw new Error('Hosted market snapshot has an invalid configuration scope')
  }
  const sourceIds = sourceIdValues.map((id) => uuid(id, 'scope source id'))
  if (new Set(sourceIds).size !== sourceIds.length || sourceIds.length > 10) {
    throw new Error('Hosted market snapshot has an invalid source selection')
  }
  const instrumentIds = memberRows.map((value) =>
    uuid(row(value, 'scope member row').instrument_id, 'scope instrument id'),
  )
  if (
    new Set(instrumentIds).size !== instrumentIds.length ||
    instrumentIds.length > 100
  ) {
    throw new Error(
      'Hosted market snapshot has an invalid instrument selection',
    )
  }
  return {
    decisionAt: timestamp(scope.decision_at, 'scope decision timestamp'),
    universeRow:
      scope.universe_row === null
        ? null
        : row(scope.universe_row, 'scope universe row'),
    memberRows,
    instrumentIds,
    sourceIds,
  }
}

export function mapHostedMarketReadResult(
  value: unknown,
  expectedOwnerId: string,
): HostedMarketSnapshot {
  const scope = mapHostedMarketScopeResult(value, expectedOwnerId)
  const payload = row((value as unknown[])[0], 'market snapshot payload')
  if (
    !Array.isArray(payload.instrument_rows) ||
    !Array.isArray(payload.session_rows) ||
    !Array.isArray(payload.health_rows)
  ) {
    throw new Error('Hosted market snapshot has invalid evidence collections')
  }
  return mapHostedMarketSnapshot({
    ownerId: expectedOwnerId,
    decisionAt: scope.decisionAt,
    universeRow: scope.universeRow,
    memberRows: scope.memberRows,
    sourceIds: scope.sourceIds,
    instrumentRows: payload.instrument_rows,
    sessionRows: payload.session_rows,
    healthRows: payload.health_rows,
  })
}

export function mapHostedMarketSnapshot(input: {
  ownerId: string
  decisionAt: string
  universeRow: unknown | null
  memberRows: readonly unknown[]
  sourceIds: readonly string[]
  instrumentRows: readonly unknown[]
  sessionRows: readonly unknown[]
  healthRows: readonly unknown[]
}): HostedMarketSnapshot {
  const ownerId = uuid(input.ownerId, 'requested owner id')
  const decisionAt = timestamp(input.decisionAt, 'requested decision timestamp')
  const universe = mapUniverse(
    input.universeRow,
    input.memberRows,
    ownerId,
    decisionAt,
  )
  const sourceIds = input.sourceIds.map((id) => uuid(id, 'requested source id'))
  if (new Set(sourceIds).size !== sourceIds.length || sourceIds.length > 10) {
    throw new Error('Hosted market snapshot has an invalid source selection')
  }
  const sources = mapSources(input.healthRows, ownerId, decisionAt, sourceIds)
  const instruments = mapInstruments(
    input.instrumentRows,
    ownerId,
    decisionAt,
    universe?.instrumentIds ?? [],
    sources,
  )
  const exchanges = new Map(
    instruments.map((instrument) => [
      instrument.exchange.id,
      instrument.exchange,
    ]),
  )
  const sessions = mapSessions(
    input.sessionRows,
    ownerId,
    decisionAt,
    exchanges,
  )

  return {
    source: 'supabase',
    decisionAt,
    timeframe: '1m',
    universe,
    sources,
    instruments,
    sessions,
  }
}

export function deriveHostedMarketSessionState(
  snapshot: HostedMarketSnapshot,
): HostedMarketSessionState {
  const decisionTime = Date.parse(snapshot.decisionAt)
  const currentSessions = snapshot.sessions.filter(
    (session) =>
      session.sessionDate ===
      dateInTimezone(snapshot.decisionAt, session.exchangeTimezone),
  )
  const open = currentSessions.find(
    (session) =>
      session.opensAt !== null &&
      session.closesAt !== null &&
      Date.parse(session.opensAt) <= decisionTime &&
      decisionTime < Date.parse(session.closesAt),
  )
  if (open) {
    return {
      state: 'open',
      label: `${open.exchangeMic} session open`,
      detail: `Calendar evidence is available for ${open.sessionDate}.`,
      tone: 'positive',
    }
  }

  const scheduled = currentSessions.find(
    (session) =>
      session.opensAt !== null && Date.parse(session.opensAt) > decisionTime,
  )
  if (scheduled) {
    return {
      state: 'scheduled',
      label: `${scheduled.exchangeMic} session scheduled`,
      detail: `The recorded session has not opened as of the decision timestamp.`,
      tone: 'info',
    }
  }

  if (currentSessions.length > 0) {
    return {
      state: 'closed',
      label: 'No recorded session is open',
      detail:
        'Current-day persisted calendar evidence records no open session.',
      tone: 'neutral',
    }
  }

  return {
    state: 'unavailable',
    label: 'Session status unavailable',
    detail:
      'No eligible exchange-session record exists at this decision timestamp.',
    tone: 'warning',
  }
}
