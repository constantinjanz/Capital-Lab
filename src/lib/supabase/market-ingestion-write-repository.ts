import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import {
  hostedIngestionBeginRowSchema,
  hostedIngestionCommitRowSchema,
  hostedIngestionFailureRowSchema,
  hostedIngestionLookupRowSchema,
  hostedSourceLifecycleRowSchema,
  parseSingleRpcRow,
  type HostedIngestionFailureClass,
  type HostedMarketIngestionInput,
  type HostedSourceLifecycleInput,
} from '@/features/markets/hosted-market-ingestion'
import type {
  HostedIngestionBegin,
  HostedIngestionRepositoryOutcome,
  HostedIngestionResult,
  HostedMarketIngestionPersistence,
} from '@/features/markets/run-hosted-market-ingestion'
import type { AlpacaHostedRequestMetadata } from '@/providers/market-data/alpaca'

import type { Database, Json } from './database.types'

const DEFINITE_REJECTION_CODES = new Set([
  '22023',
  '23505',
  '23514',
  '42501',
  '55000',
])

type RpcError = { code?: string } | null

function failureReason(error: RpcError): 'rejected' | 'unknown' {
  return error?.code && DEFINITE_REJECTION_CODES.has(error.code)
    ? 'rejected'
    : 'unknown'
}

function beginResult(row: {
  operation_id: string
  ingestion_run_id: string
  source_id: string
  status: 'running' | 'completed' | 'failed'
  symbols: string[]
  replayed: boolean
}): HostedIngestionBegin {
  return {
    operationId: row.operation_id,
    ingestionRunId: row.ingestion_run_id,
    sourceId: row.source_id,
    status: row.status,
    symbols: row.symbols,
    replayed: row.replayed,
  }
}

function ingestionResult(
  row: {
    operation_id: string
    ingestion_run_id: string
    source_id: string
    status: 'running' | 'completed' | 'failed' | 'partial'
    records_seen: number
    records_inserted: number
    records_reused: number
    records_rejected: number
    finished_at: string | null
    error_class?: HostedIngestionFailureClass | null
    replayed?: boolean
  },
  reconciled = false,
): HostedIngestionResult {
  return {
    operationId: row.operation_id,
    ingestionRunId: row.ingestion_run_id,
    sourceId: row.source_id,
    status: row.status,
    recordsSeen: row.records_seen,
    recordsInserted: row.records_inserted,
    recordsReused: row.records_reused,
    recordsRejected: row.records_rejected,
    finishedAt: row.finished_at,
    errorClass: row.error_class ?? null,
    replayed: row.replayed ?? reconciled,
  }
}

async function rpcOutcome<T>(
  request: PromiseLike<{ data: unknown; error: RpcError }>,
  map: (data: unknown) => T | null,
): Promise<HostedIngestionRepositoryOutcome<T>> {
  let response: { data: unknown; error: RpcError }
  try {
    response = await request
  } catch {
    return { ok: false, reason: 'unknown' }
  }
  if (response.error) {
    return { ok: false, reason: failureReason(response.error) }
  }
  const value = map(response.data)
  return value ? { ok: true, value } : { ok: false, reason: 'unknown' }
}

export type HostedSourceLifecycleResult = {
  operationId: string
  sourceId: string
  policyId: string
  policyVersion: number
  enabled: boolean
  replayed: boolean
  effectiveAt: string
}

export async function setHostedMarketSourceEnabled(
  supabase: SupabaseClient<Database>,
  input: HostedSourceLifecycleInput,
): Promise<HostedIngestionRepositoryOutcome<HostedSourceLifecycleResult>> {
  return rpcOutcome(
    supabase.rpc('set_hosted_market_source_enabled', {
      p_operation_id: input.operationId,
      p_enabled: input.enabled,
    }),
    (data) => {
      const row = parseSingleRpcRow(
        hostedSourceLifecycleRowSchema,
        data,
        input.operationId,
      )
      if (
        !row ||
        row.enabled !== input.enabled ||
        row.status !== (input.enabled ? 'enabled' : 'disabled')
      ) {
        return null
      }
      return {
        operationId: row.operation_id,
        sourceId: row.source_id,
        policyId: row.policy_id,
        policyVersion: row.policy_version,
        enabled: row.enabled,
        replayed: row.replayed,
        effectiveAt: row.effective_at,
      }
    },
  )
}

function requestMetadata(
  requests: readonly AlpacaHostedRequestMetadata[],
): Json | null {
  const quoteRequests = requests.filter(
    (request) => request.operation === 'latest_quotes',
  )
  const barRequests = requests.filter(
    (request) => request.operation === 'completed_minute_bars',
  )
  if (
    quoteRequests.length !== 1 ||
    quoteRequests[0]?.page !== 1 ||
    !quoteRequests[0]?.requestId ||
    barRequests.length < 1 ||
    barRequests.length > 5 ||
    barRequests.some(
      (request, index) => !request.requestId || request.page !== index + 1,
    )
  ) {
    return null
  }
  const requestIds = requests.map((request) => request.requestId!)
  if (new Set(requestIds).size !== requestIds.length) return null
  return {
    feed: 'iex',
    quote_request_id: quoteRequests[0].requestId,
    bar_request_ids: barRequests.map((request) => request.requestId!),
  }
}

export function createHostedMarketIngestionPersistence(
  supabase: SupabaseClient<Database>,
): HostedMarketIngestionPersistence {
  return {
    async begin(input: HostedMarketIngestionInput) {
      return rpcOutcome(
        supabase.rpc('begin_manual_hosted_market_ingestion', {
          p_operation_id: input.operationId,
          p_window_start: input.windowStart,
          p_window_end: input.windowEnd,
        }),
        (data) => {
          const row = parseSingleRpcRow(
            hostedIngestionBeginRowSchema,
            data,
            input.operationId,
          )
          return row ? beginResult(row) : null
        },
      )
    },

    async commit(input) {
      const metadata = requestMetadata(input.requests)
      if (!metadata) return { ok: false, reason: 'rejected' }
      const quotes: Json = input.quotes.map((quote) => ({
        symbol: quote.symbol,
        provider_event_at: quote.providerEventAt,
        bid_price: quote.bidPrice,
        ask_price: quote.askPrice,
        bid_size: quote.bidSize,
        ask_size: quote.askSize,
      }))
      const bars: Json = input.bars.map((bar) => ({
        symbol: bar.symbol,
        bar_start: bar.startAt,
        bar_end: bar.endAt,
        open_price: bar.open,
        high_price: bar.high,
        low_price: bar.low,
        close_price: bar.close,
        volume: bar.volume,
      }))
      return rpcOutcome(
        supabase.rpc('commit_manual_hosted_market_ingestion', {
          p_operation_id: input.operationId,
          p_request_metadata: metadata,
          p_quotes: quotes,
          p_bars: bars,
          p_latency_ms: input.latencyMs,
        }),
        (data) => {
          const row = parseSingleRpcRow(
            hostedIngestionCommitRowSchema,
            data,
            input.operationId,
          )
          return row ? ingestionResult(row) : null
        },
      )
    },

    async fail(input) {
      return rpcOutcome(
        supabase.rpc('fail_manual_hosted_market_ingestion', {
          p_operation_id: input.operationId,
          p_error_class: input.errorClass,
          p_latency_ms: input.latencyMs,
        }),
        (data) => {
          const row = parseSingleRpcRow(
            hostedIngestionFailureRowSchema,
            data,
            input.operationId,
          )
          return row ? ingestionResult(row) : null
        },
      )
    },

    async result(operationId) {
      return rpcOutcome(
        supabase.rpc('manual_hosted_market_ingestion_result', {
          p_operation_id: operationId,
        }),
        (data) => {
          const row = parseSingleRpcRow(
            hostedIngestionLookupRowSchema,
            data,
            operationId,
          )
          return row ? ingestionResult(row, true) : null
        },
      )
    },
  }
}
