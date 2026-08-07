import 'server-only'

import {
  AlpacaMarketDataError,
  type AlpacaHostedMinuteBarRecord,
  type AlpacaHostedQuoteRecord,
  type AlpacaHostedRequestMetadata,
  type AlpacaMarketDataProvider,
} from '@/providers/market-data/alpaca'

import {
  HOSTED_ALPACA_SYMBOLS,
  type HostedIngestionFailureClass,
  type HostedMarketIngestionInput,
} from './hosted-market-ingestion'

export type HostedIngestionBegin = {
  operationId: string
  ingestionRunId: string
  sourceId: string
  status: 'running' | 'completed' | 'failed'
  symbols: string[]
  replayed: boolean
}

export type HostedIngestionResult = {
  operationId: string
  ingestionRunId: string
  sourceId: string
  status: 'running' | 'completed' | 'failed' | 'partial'
  recordsSeen: number
  recordsInserted: number
  recordsReused: number
  recordsRejected: number
  finishedAt: string | null
  errorClass: HostedIngestionFailureClass | null
  replayed: boolean
}

export type HostedIngestionRepositoryOutcome<T> =
  { ok: true; value: T } | { ok: false; reason: 'rejected' | 'unknown' }

export interface HostedMarketIngestionPersistence {
  begin(
    input: HostedMarketIngestionInput,
  ): Promise<HostedIngestionRepositoryOutcome<HostedIngestionBegin>>
  commit(input: {
    operationId: string
    requests: AlpacaHostedRequestMetadata[]
    quotes: AlpacaHostedQuoteRecord[]
    bars: AlpacaHostedMinuteBarRecord[]
    latencyMs: number
  }): Promise<HostedIngestionRepositoryOutcome<HostedIngestionResult>>
  fail(input: {
    operationId: string
    errorClass: HostedIngestionFailureClass
    latencyMs: number
  }): Promise<HostedIngestionRepositoryOutcome<HostedIngestionResult>>
  result(
    operationId: string,
  ): Promise<HostedIngestionRepositoryOutcome<HostedIngestionResult>>
}

export type HostedIngestionRunOutcome =
  | { status: 'completed' | 'replayed'; result: HostedIngestionResult }
  | { status: 'provider-error'; errorClass: string }
  | { status: 'rejected' }
  | { status: 'unknown' }

function latencyMilliseconds(startedAt: number, now: () => number): number {
  return Math.max(0, Math.min(120_000, Math.round(now() - startedAt)))
}

function exactReviewedSymbols(symbols: readonly string[]): boolean {
  return (
    symbols.length === HOSTED_ALPACA_SYMBOLS.length &&
    HOSTED_ALPACA_SYMBOLS.every((symbol) => symbols.includes(symbol))
  )
}

function persistenceFailureClass(
  error: unknown,
): Exclude<HostedIngestionFailureClass, 'persistence_rejected'> {
  if (!(error instanceof AlpacaMarketDataError)) return 'network_error'
  switch (error.code) {
    case 'timeout':
      return 'timeout'
    case 'network':
      return 'network_error'
    case 'unauthorized':
    case 'forbidden':
      return 'http_unauthorized'
    case 'rate_limited':
      return 'http_rate_limited'
    case 'provider_unavailable':
      return 'http_server_error'
    default:
      return 'invalid_response'
  }
}

async function reconcileResult(
  persistence: HostedMarketIngestionPersistence,
  operationId: string,
): Promise<HostedIngestionRunOutcome> {
  const reconciliation = await persistence.result(operationId)
  if (!reconciliation.ok) return { status: reconciliation.reason }
  if (reconciliation.value.status === 'completed') {
    return { status: 'replayed', result: reconciliation.value }
  }
  if (reconciliation.value.status === 'failed') {
    return {
      status: 'provider-error',
      errorClass: reconciliation.value.errorClass ?? 'provider_unavailable',
    }
  }
  return { status: 'unknown' }
}

export async function runOwnerTriggeredAlpacaIngestion(input: {
  request: HostedMarketIngestionInput
  persistence: HostedMarketIngestionPersistence
  provider: AlpacaMarketDataProvider
  now?: () => number
}): Promise<HostedIngestionRunOutcome> {
  const now = input.now ?? Date.now
  const begin = await input.persistence.begin(input.request)
  if (!begin.ok) return { status: begin.reason }
  if (!exactReviewedSymbols(begin.value.symbols)) return { status: 'rejected' }

  if (begin.value.replayed || begin.value.status !== 'running') {
    return reconcileResult(input.persistence, input.request.operationId)
  }

  const startedAt = now()
  try {
    const quoteBatch = await input.provider.getHostedLatestQuotes({
      symbols: HOSTED_ALPACA_SYMBOLS,
    })
    if (
      quoteBatch.missingSymbols.length > 0 ||
      quoteBatch.records.length !== HOSTED_ALPACA_SYMBOLS.length ||
      !exactReviewedSymbols(quoteBatch.records.map((record) => record.symbol))
    ) {
      throw new AlpacaMarketDataError('invalid_payload', 'latest_quotes')
    }

    const barBatch = await input.provider.getHostedCompletedMinuteBars({
      symbols: HOSTED_ALPACA_SYMBOLS,
      startAt: input.request.windowStart,
      endAt: input.request.windowEnd,
      asOf: input.request.windowEnd,
    })
    const commitInput = {
      operationId: input.request.operationId,
      requests: [...quoteBatch.requests, ...barBatch.requests],
      quotes: quoteBatch.records,
      bars: barBatch.records,
      latencyMs: latencyMilliseconds(startedAt, now),
    }
    let commit = await input.persistence.commit(commitInput)
    if (!commit.ok && commit.reason === 'unknown') {
      const reconciliation = await input.persistence.result(
        input.request.operationId,
      )
      if (!reconciliation.ok) return { status: reconciliation.reason }
      if (reconciliation.value.status === 'completed') {
        return { status: 'replayed', result: reconciliation.value }
      }
      if (reconciliation.value.status === 'failed') {
        return {
          status: 'provider-error',
          errorClass: reconciliation.value.errorClass ?? 'http_server_error',
        }
      }
      if (reconciliation.value.status !== 'running') {
        return { status: 'unknown' }
      }
      commit = await input.persistence.commit(commitInput)
    }
    if (commit.ok) {
      return {
        status: commit.value.replayed ? 'replayed' : 'completed',
        result: commit.value,
      }
    }
    if (commit.reason === 'unknown') {
      return reconcileResult(input.persistence, input.request.operationId)
    }

    const failed = await input.persistence.fail({
      operationId: input.request.operationId,
      errorClass: 'persistence_rejected',
      latencyMs: latencyMilliseconds(startedAt, now),
    })
    return failed.ok ? { status: 'rejected' } : { status: failed.reason }
  } catch (error) {
    const errorClass = persistenceFailureClass(error)
    const failed = await input.persistence.fail({
      operationId: input.request.operationId,
      errorClass,
      latencyMs: latencyMilliseconds(startedAt, now),
    })
    if (!failed.ok) return { status: failed.reason }
    return { status: 'provider-error', errorClass }
  }
}
