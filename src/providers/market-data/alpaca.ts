import 'server-only'

import { z } from 'zod'

import { decimal } from '@/domain/financial/decimal'

import { parseLosslessProviderJson } from './lossless-json'
import {
  boundedProviderDecimalTextSchema,
  marketBarSchema,
  marketQuoteSchema,
  type MarketBar,
  type MarketDataProvider,
  type MarketQuote,
} from './types'

const ALPACA_MARKET_DATA_ORIGIN = 'https://data.alpaca.markets'
const ALPACA_ENDPOINTS = {
  latest_quotes: '/v2/stocks/quotes/latest',
  completed_minute_bars: '/v2/stocks/bars',
} as const

export const ALPACA_HOSTED_LIMITS = {
  maxSymbols: 5,
  maxSymbolLength: 16,
  maxOneMinuteRangeMs: 86_400_000,
  pageSize: 1_000,
  maxPages: 5,
  maxRecords: 5_000,
  maxQuoteResponseBytes: 256 * 1_024,
  maxBarPageBytes: 2 * 1_024 * 1_024,
  maxBarResponseBytes: 8 * 1_024 * 1_024,
  maxPageTokenLength: 512,
  maxRequestIdLength: 128,
  requestTimeoutMs: 8_000,
  batchTimeoutMs: 20_000,
} as const

const providerSymbolSchema = z
  .string()
  .min(1)
  .max(ALPACA_HOSTED_LIMITS.maxSymbolLength)
  .regex(/^[A-Z][A-Z0-9.]*$/)
const providerRequestIdSchema = z
  .string()
  .min(1)
  .max(ALPACA_HOSTED_LIMITS.maxRequestIdLength)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
const providerPageTokenSchema = z
  .string()
  .min(1)
  .max(ALPACA_HOSTED_LIMITS.maxPageTokenLength)

const quoteWireSchema = z
  .object({
    ap: boundedProviderDecimalTextSchema,
    as: boundedProviderDecimalTextSchema,
    ax: z.string().max(16).optional(),
    bp: boundedProviderDecimalTextSchema,
    bs: boundedProviderDecimalTextSchema,
    bx: z.string().max(16).optional(),
    c: z.array(z.string().max(32)).max(32).optional(),
    t: z.iso.datetime(),
    z: z.string().max(16).optional(),
  })
  .strict()

const quotePayloadSchema = z
  .object({
    quotes: z.record(providerSymbolSchema, quoteWireSchema),
  })
  .strict()

const barWireSchema = z
  .object({
    c: boundedProviderDecimalTextSchema,
    h: boundedProviderDecimalTextSchema,
    l: boundedProviderDecimalTextSchema,
    n: boundedProviderDecimalTextSchema.optional(),
    o: boundedProviderDecimalTextSchema,
    t: z.iso.datetime(),
    v: boundedProviderDecimalTextSchema,
    vw: boundedProviderDecimalTextSchema.optional(),
  })
  .strict()

const barsPayloadSchema = z
  .object({
    bars: z.record(
      providerSymbolSchema,
      z.array(barWireSchema).max(ALPACA_HOSTED_LIMITS.pageSize),
    ),
    next_page_token: providerPageTokenSchema.nullable().optional(),
  })
  .strict()

export type AlpacaHostedOperation = keyof typeof ALPACA_ENDPOINTS

export type AlpacaMarketDataErrorCode =
  | 'invalid_request'
  | 'timeout'
  | 'network'
  | 'redirect_refused'
  | 'unauthorized'
  | 'forbidden'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'provider_rejected'
  | 'response_too_large'
  | 'invalid_content_type'
  | 'invalid_payload'
  | 'pagination_exhausted'

const retryableCodes = new Set<AlpacaMarketDataErrorCode>([
  'timeout',
  'network',
  'rate_limited',
  'provider_unavailable',
])

export class AlpacaMarketDataError extends Error {
  readonly provider = 'alpaca-market-data'
  readonly retryable: boolean

  constructor(
    readonly code: AlpacaMarketDataErrorCode,
    readonly operation: AlpacaHostedOperation,
    readonly status: number | null = null,
    readonly requestId: string | null = null,
  ) {
    super(`Alpaca market-data ${operation} failed safely (${code})`)
    this.name = 'AlpacaMarketDataError'
    this.retryable = retryableCodes.has(code)
  }
}

export interface AlpacaHostedRequestMetadata {
  operation: AlpacaHostedOperation
  page: number
  requestId: string | null
  requestedAt: string
  receivedAt: string
  responseBytes: number
  recordCount: number
}

export interface AlpacaHostedQuoteRecord {
  symbol: string
  bidPrice: string
  askPrice: string
  bidSize: string
  askSize: string
  currency: 'USD'
  provider: 'alpaca-market-data'
  providerEventAt: string
  providerRecordKey: string
}

export interface AlpacaHostedMinuteBarRecord {
  symbol: string
  timeframe: '1m'
  startAt: string
  endAt: string
  open: string
  high: string
  low: string
  close: string
  volume: string
  currency: 'USD'
  provider: 'alpaca-market-data'
  providerEventAt: string
  providerRecordKey: string
}

export interface AlpacaHostedBatch<TRecord> {
  records: TRecord[]
  missingSymbols: string[]
  requests: AlpacaHostedRequestMetadata[]
}

export type AlpacaMarketDataOptions = {
  keyId: string
  secretKey: string
  feed: 'iex' | 'sip' | 'delayed_sip'
  fetcher?: typeof fetch
  now?: () => Date
  monotonicNow?: () => number
  timeoutMs?: number
  batchTimeoutMs?: number
}

type RawRequestResult = {
  body: string
  metadata: Omit<AlpacaHostedRequestMetadata, 'recordCount'>
}

function providerError(
  code: AlpacaMarketDataErrorCode,
  operation: AlpacaHostedOperation,
  status: number | null = null,
  requestId: string | null = null,
): AlpacaMarketDataError {
  return new AlpacaMarketDataError(code, operation, status, requestId)
}

function validatedSymbols(
  input: unknown,
  operation: AlpacaHostedOperation,
): string[] {
  const result = z
    .array(providerSymbolSchema)
    .min(1)
    .max(ALPACA_HOSTED_LIMITS.maxSymbols)
    .safeParse(input)
  if (!result.success || new Set(result.data).size !== result.data.length) {
    throw providerError('invalid_request', operation)
  }
  return [...result.data].sort((left, right) => left.localeCompare(right))
}

function normalizedTimestamp(
  input: string,
  operation: AlpacaHostedOperation,
  errorCode: Extract<
    AlpacaMarketDataErrorCode,
    'invalid_request' | 'invalid_payload'
  > = 'invalid_request',
): { iso: string; milliseconds: number } {
  if (!z.iso.datetime().safeParse(input).success) {
    throw providerError(errorCode, operation)
  }
  const milliseconds = Date.parse(input)
  if (!Number.isFinite(milliseconds)) {
    throw providerError(errorCode, operation)
  }
  return { iso: new Date(milliseconds).toISOString(), milliseconds }
}

function completedMinuteEnd(startAt: string): string {
  const milliseconds = Date.parse(startAt)
  if (!Number.isFinite(milliseconds)) {
    throw new TypeError('Invalid provider timestamp')
  }
  return new Date(milliseconds + 60_000).toISOString()
}

function validateQuoteValues(
  quote: z.infer<typeof quoteWireSchema>,
  operation: AlpacaHostedOperation,
): void {
  try {
    if (decimal(quote.ap).lt(decimal(quote.bp))) {
      throw providerError('invalid_payload', operation)
    }
  } catch (error) {
    if (error instanceof AlpacaMarketDataError) throw error
    throw providerError('invalid_payload', operation)
  }
}

function validateBarValues(
  bar: z.infer<typeof barWireSchema>,
  operation: AlpacaHostedOperation,
): void {
  try {
    const open = decimal(bar.o)
    const high = decimal(bar.h)
    const low = decimal(bar.l)
    const close = decimal(bar.c)
    if (
      high.lt(open) ||
      high.lt(low) ||
      high.lt(close) ||
      low.gt(open) ||
      low.gt(high) ||
      low.gt(close)
    ) {
      throw providerError('invalid_payload', operation)
    }
  } catch (error) {
    if (error instanceof AlpacaMarketDataError) throw error
    throw providerError('invalid_payload', operation)
  }
}

async function readBoundedUtf8Body(
  response: Response,
  maxBytes: number,
  operation: AlpacaHostedOperation,
  requestId: string | null,
): Promise<{ body: string; bytes: number }> {
  const contentLength = response.headers.get('content-length')
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) {
      throw providerError(
        'invalid_payload',
        operation,
        response.status,
        requestId,
      )
    }
    if (BigInt(contentLength) > BigInt(maxBytes)) {
      throw providerError(
        'response_too_large',
        operation,
        response.status,
        requestId,
      )
    }
  }

  if (!response.body) return { body: '', bytes: 0 }
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytes = 0
  let body = ''

  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw providerError(
          'response_too_large',
          operation,
          response.status,
          requestId,
        )
      }
      body += decoder.decode(chunk.value, { stream: true })
    }
    body += decoder.decode()
    return { body, bytes }
  } catch (error) {
    if (error instanceof AlpacaMarketDataError) throw error
    throw providerError(
      'invalid_payload',
      operation,
      response.status,
      requestId,
    )
  } finally {
    reader.releaseLock()
  }
}

function parsePayload<TOutput>(
  body: string,
  schema: z.ZodType<TOutput>,
  operation: AlpacaHostedOperation,
  requestId: string | null,
): TOutput {
  try {
    const result = schema.safeParse(parseLosslessProviderJson(body))
    if (!result.success) throw new TypeError('Invalid provider payload')
    return result.data
  } catch {
    throw providerError('invalid_payload', operation, null, requestId)
  }
}

export class AlpacaMarketDataProvider implements MarketDataProvider {
  readonly name = 'alpaca-market-data'
  readonly mode = 'live' as const
  private readonly fetcher: typeof fetch
  private readonly now: () => Date
  private readonly monotonicNow: () => number
  private readonly timeoutMs: number
  private readonly batchTimeoutMs: number

  constructor(private readonly options: AlpacaMarketDataOptions) {
    this.fetcher = options.fetcher ?? fetch
    this.now = options.now ?? (() => new Date())
    this.monotonicNow = options.monotonicNow ?? Date.now
    this.timeoutMs = options.timeoutMs ?? ALPACA_HOSTED_LIMITS.requestTimeoutMs
    this.batchTimeoutMs =
      options.batchTimeoutMs ?? ALPACA_HOSTED_LIMITS.batchTimeoutMs
    if (
      !Number.isInteger(this.timeoutMs) ||
      this.timeoutMs < 1 ||
      this.timeoutMs > ALPACA_HOSTED_LIMITS.requestTimeoutMs
    ) {
      throw new TypeError('Invalid Alpaca Market Data timeout')
    }
    if (
      !Number.isInteger(this.batchTimeoutMs) ||
      this.batchTimeoutMs < 1 ||
      this.batchTimeoutMs > ALPACA_HOSTED_LIMITS.batchTimeoutMs
    ) {
      throw new TypeError('Invalid Alpaca Market Data batch timeout')
    }
  }

  private nowIso(operation: AlpacaHostedOperation): string {
    const value = this.now()
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw providerError('invalid_request', operation)
    }
    return value.toISOString()
  }

  private requireHostedIex(operation: AlpacaHostedOperation): void {
    if (this.options.feed !== 'iex') {
      throw providerError('invalid_request', operation)
    }
  }

  private monotonicTimestamp(operation: AlpacaHostedOperation): number {
    const value = this.monotonicNow()
    if (!Number.isFinite(value))
      throw providerError('invalid_request', operation)
    return value
  }

  private remainingBatchMilliseconds(
    operation: AlpacaHostedOperation,
    startedAt: number,
  ): number {
    const elapsed = this.monotonicTimestamp(operation) - startedAt
    if (elapsed < 0) throw providerError('invalid_request', operation)
    const remaining = this.batchTimeoutMs - elapsed
    if (remaining <= 0) throw providerError('timeout', operation)
    return Math.max(1, Math.min(this.timeoutMs, Math.ceil(remaining)))
  }

  private validatedRequestId(
    response: Response,
    operation: AlpacaHostedOperation,
  ): string | null {
    const value = response.headers.get('apca-request-id')
    if (value === null) return null
    const result = providerRequestIdSchema.safeParse(value.trim())
    if (!result.success) {
      throw providerError('invalid_payload', operation, response.status)
    }
    return result.data
  }

  private async request(
    operation: AlpacaHostedOperation,
    parameters: URLSearchParams,
    maxBytes: number,
    page: number,
    timeoutMs: number,
  ): Promise<RawRequestResult> {
    const pathname = ALPACA_ENDPOINTS[operation]
    const url = new URL(pathname, ALPACA_MARKET_DATA_ORIGIN)
    url.search = parameters.toString()
    if (
      url.origin !== ALPACA_MARKET_DATA_ORIGIN ||
      url.pathname !== pathname ||
      url.username !== '' ||
      url.password !== ''
    ) {
      throw providerError('redirect_refused', operation)
    }

    const requestedAt = this.nowIso(operation)
    const controller = new AbortController()
    let timedOut = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    const timeoutFailure = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        timedOut = true
        controller.abort()
        reject(providerError('timeout', operation))
      }, timeoutMs)
    })

    let response: Response
    try {
      response = await Promise.race([
        this.fetcher(url, {
          method: 'GET',
          headers: {
            'APCA-API-KEY-ID': this.options.keyId,
            'APCA-API-SECRET-KEY': this.options.secretKey,
            Accept: 'application/json',
          },
          redirect: 'error',
          cache: 'no-store',
          signal: controller.signal,
        }),
        timeoutFailure,
      ])
    } catch (error) {
      if (timeout !== undefined) clearTimeout(timeout)
      if (error instanceof AlpacaMarketDataError) throw error
      if (timedOut || controller.signal.aborted) {
        throw providerError('timeout', operation)
      }
      throw providerError('network', operation)
    }

    try {
      const requestId = this.validatedRequestId(response, operation)
      if (response.redirected) {
        throw providerError(
          'redirect_refused',
          operation,
          response.status,
          requestId,
        )
      }
      if (response.url) {
        try {
          const finalUrl = new URL(response.url)
          if (
            finalUrl.origin !== ALPACA_MARKET_DATA_ORIGIN ||
            finalUrl.pathname !== pathname
          ) {
            throw providerError(
              'redirect_refused',
              operation,
              response.status,
              requestId,
            )
          }
        } catch (error) {
          if (error instanceof AlpacaMarketDataError) throw error
          throw providerError(
            'redirect_refused',
            operation,
            response.status,
            requestId,
          )
        }
      }
      if (response.status >= 300 && response.status < 400) {
        throw providerError(
          'redirect_refused',
          operation,
          response.status,
          requestId,
        )
      }
      if (!response.ok) {
        const code: AlpacaMarketDataErrorCode =
          response.status === 401
            ? 'unauthorized'
            : response.status === 403
              ? 'forbidden'
              : response.status === 429
                ? 'rate_limited'
                : response.status >= 500
                  ? 'provider_unavailable'
                  : 'provider_rejected'
        throw providerError(code, operation, response.status, requestId)
      }

      const contentType = response.headers
        .get('content-type')
        ?.split(';', 1)[0]
        ?.trim()
        .toLowerCase()
      if (
        contentType !== 'application/json' &&
        !contentType?.endsWith('+json')
      ) {
        throw providerError(
          'invalid_content_type',
          operation,
          response.status,
          requestId,
        )
      }

      let result: { body: string; bytes: number }
      try {
        result = await Promise.race([
          readBoundedUtf8Body(response, maxBytes, operation, requestId),
          timeoutFailure,
        ])
      } catch (error) {
        if (timedOut) throw providerError('timeout', operation)
        throw error
      }
      return {
        body: result.body,
        metadata: {
          operation,
          page,
          requestId,
          requestedAt,
          receivedAt: this.nowIso(operation),
          responseBytes: result.bytes,
        },
      }
    } finally {
      if (timeout !== undefined) clearTimeout(timeout)
    }
  }

  async getHostedLatestQuotes(input: {
    symbols: readonly string[]
  }): Promise<AlpacaHostedBatch<AlpacaHostedQuoteRecord>> {
    const operation: AlpacaHostedOperation = 'latest_quotes'
    this.requireHostedIex(operation)
    const batchStartedAt = this.monotonicTimestamp(operation)
    const symbols = validatedSymbols(input.symbols, operation)
    const requested = new Set(symbols)
    const result = await this.request(
      operation,
      new URLSearchParams({
        symbols: symbols.join(','),
        feed: 'iex',
      }),
      ALPACA_HOSTED_LIMITS.maxQuoteResponseBytes,
      1,
      this.remainingBatchMilliseconds(operation, batchStartedAt),
    )
    const payload = parsePayload(
      result.body,
      quotePayloadSchema,
      operation,
      result.metadata.requestId,
    )
    const entries = Object.entries(payload.quotes)
    if (entries.length > ALPACA_HOSTED_LIMITS.maxSymbols) {
      throw providerError('invalid_payload', operation)
    }

    const records = entries.map(([symbol, quote]) => {
      if (!requested.has(symbol)) {
        throw providerError('invalid_payload', operation)
      }
      validateQuoteValues(quote, operation)
      return {
        symbol,
        bidPrice: quote.bp,
        askPrice: quote.ap,
        bidSize: quote.bs,
        askSize: quote.as,
        currency: 'USD',
        provider: 'alpaca-market-data',
        providerEventAt: quote.t,
        providerRecordKey: `${symbol}:${quote.t}`,
      } satisfies AlpacaHostedQuoteRecord
    })
    records.sort((left, right) => left.symbol.localeCompare(right.symbol))
    const received = new Set(records.map((record) => record.symbol))
    this.remainingBatchMilliseconds(operation, batchStartedAt)

    return {
      records,
      missingSymbols: symbols.filter((symbol) => !received.has(symbol)),
      requests: [{ ...result.metadata, recordCount: records.length }],
    }
  }

  async getHostedCompletedMinuteBars(input: {
    symbols: readonly string[]
    startAt: string
    endAt: string
    asOf: string
  }): Promise<AlpacaHostedBatch<AlpacaHostedMinuteBarRecord>> {
    const operation: AlpacaHostedOperation = 'completed_minute_bars'
    this.requireHostedIex(operation)
    const batchStartedAt = this.monotonicTimestamp(operation)
    const symbols = validatedSymbols(input.symbols, operation)
    const requested = new Set(symbols)
    const start = normalizedTimestamp(input.startAt, operation)
    const end = normalizedTimestamp(input.endAt, operation)
    const asOf = normalizedTimestamp(input.asOf, operation)
    const requestedAt = normalizedTimestamp(this.nowIso(operation), operation)
    if (
      start.milliseconds >= end.milliseconds ||
      end.milliseconds > asOf.milliseconds ||
      asOf.milliseconds > requestedAt.milliseconds ||
      end.milliseconds - start.milliseconds >
        ALPACA_HOSTED_LIMITS.maxOneMinuteRangeMs
    ) {
      throw providerError('invalid_request', operation)
    }

    const records: AlpacaHostedMinuteBarRecord[] = []
    const requests: AlpacaHostedRequestMetadata[] = []
    const seenRecordKeys = new Set<string>()
    const seenPageTokens = new Set<string>()
    let nextPageToken: string | undefined
    let totalBytes = 0

    for (let page = 1; page <= ALPACA_HOSTED_LIMITS.maxPages; page += 1) {
      const parameters = new URLSearchParams({
        symbols: symbols.join(','),
        start: start.iso,
        end: end.iso,
        timeframe: '1Min',
        feed: 'iex',
        adjustment: 'raw',
        asof: asOf.iso.slice(0, 10),
        sort: 'asc',
        limit: String(ALPACA_HOSTED_LIMITS.pageSize),
      })
      if (nextPageToken) parameters.set('page_token', nextPageToken)

      const result = await this.request(
        operation,
        parameters,
        ALPACA_HOSTED_LIMITS.maxBarPageBytes,
        page,
        this.remainingBatchMilliseconds(operation, batchStartedAt),
      )
      totalBytes += result.metadata.responseBytes
      if (totalBytes > ALPACA_HOSTED_LIMITS.maxBarResponseBytes) {
        throw providerError(
          'response_too_large',
          operation,
          null,
          result.metadata.requestId,
        )
      }

      const payload = parsePayload(
        result.body,
        barsPayloadSchema,
        operation,
        result.metadata.requestId,
      )
      let pageRecordCount = 0
      for (const [symbol, bars] of Object.entries(payload.bars)) {
        if (!requested.has(symbol)) {
          throw providerError('invalid_payload', operation)
        }
        for (const bar of bars) {
          pageRecordCount += 1
          if (
            pageRecordCount > ALPACA_HOSTED_LIMITS.pageSize ||
            records.length >= ALPACA_HOSTED_LIMITS.maxRecords
          ) {
            throw providerError('pagination_exhausted', operation)
          }
          validateBarValues(bar, operation)
          const barStart = normalizedTimestamp(
            bar.t,
            operation,
            'invalid_payload',
          )
          const barEndAt = completedMinuteEnd(barStart.iso)
          const barEndMilliseconds = Date.parse(barEndAt)
          if (
            barStart.milliseconds < start.milliseconds ||
            barEndMilliseconds > end.milliseconds ||
            barEndMilliseconds > asOf.milliseconds
          ) {
            throw providerError('invalid_payload', operation)
          }
          const providerRecordKey = `${symbol}:1m:${barStart.iso}`
          if (seenRecordKeys.has(providerRecordKey)) {
            throw providerError('invalid_payload', operation)
          }
          seenRecordKeys.add(providerRecordKey)
          records.push({
            symbol,
            timeframe: '1m',
            startAt: barStart.iso,
            endAt: barEndAt,
            open: bar.o,
            high: bar.h,
            low: bar.l,
            close: bar.c,
            volume: bar.v,
            currency: 'USD',
            provider: 'alpaca-market-data',
            providerEventAt: barStart.iso,
            providerRecordKey,
          })
        }
      }
      requests.push({ ...result.metadata, recordCount: pageRecordCount })
      this.remainingBatchMilliseconds(operation, batchStartedAt)

      const token = payload.next_page_token ?? undefined
      if (!token) {
        nextPageToken = undefined
        break
      }
      if (seenPageTokens.has(token) || page === ALPACA_HOSTED_LIMITS.maxPages) {
        throw providerError('pagination_exhausted', operation)
      }
      seenPageTokens.add(token)
      nextPageToken = token
    }

    records.sort((left, right) => {
      const byStart = left.startAt.localeCompare(right.startAt)
      return byStart === 0 ? left.symbol.localeCompare(right.symbol) : byStart
    })
    const received = new Set(records.map((record) => record.symbol))
    return {
      records,
      missingSymbols: symbols.filter((symbol) => !received.has(symbol)),
      requests,
    }
  }

  async getLatestQuotes(
    symbols: readonly string[],
    observedAt: string,
  ): Promise<MarketQuote[]> {
    const observed = normalizedTimestamp(observedAt, 'latest_quotes').iso
    const batch = await this.getHostedLatestQuotes({ symbols })
    const providerReceivedAt = batch.requests[0]?.receivedAt
    return batch.records.map((quote) =>
      marketQuoteSchema.parse({
        id: `alpaca-quote-${quote.providerRecordKey}`,
        instrumentId: `symbol:${quote.symbol}`,
        symbol: quote.symbol,
        bidPrice: quote.bidPrice,
        askPrice: quote.askPrice,
        bidSize: quote.bidSize,
        askSize: quote.askSize,
        currency: quote.currency,
        provider: quote.provider,
        providerEventAt: quote.providerEventAt,
        providerReceivedAt,
        firstSeenAt: observed,
        availableAt: observed,
        ingestedAt: observed,
        sourceIdentifier: quote.providerRecordKey,
        revision: 'original',
        synthetic: false,
      }),
    )
  }

  async getBars(
    symbols: readonly string[],
    startAt: string,
    endAt: string,
    timeframe: string,
    observedAt: string,
  ): Promise<MarketBar[]> {
    if (timeframe !== '1m' && timeframe !== '1Min') {
      throw providerError('invalid_request', 'completed_minute_bars')
    }
    const observed = normalizedTimestamp(
      observedAt,
      'completed_minute_bars',
    ).iso
    const batch = await this.getHostedCompletedMinuteBars({
      symbols,
      startAt,
      endAt,
      asOf: observed,
    })
    const providerReceivedAt = batch.requests.at(-1)?.receivedAt
    return batch.records.map((bar) =>
      marketBarSchema.parse({
        id: `alpaca-bar-${bar.providerRecordKey}`,
        instrumentId: `symbol:${bar.symbol}`,
        symbol: bar.symbol,
        timeframe: bar.timeframe,
        startAt: bar.startAt,
        endAt: bar.endAt,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        currency: bar.currency,
        provider: bar.provider,
        providerEventAt: bar.providerEventAt,
        providerReceivedAt,
        firstSeenAt: observed,
        availableAt: observed,
        ingestedAt: observed,
        sourceIdentifier: bar.providerRecordKey,
        revision: 'original',
        synthetic: false,
      }),
    )
  }
}
