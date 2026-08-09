import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { createSupabaseServerClient } from '@/lib/auth/supabase/server'
import type { Database } from '@/lib/supabase/database.types'

export type HostedStorageStatus =
  | { available: false; reason: string }
  | {
      available: true
      capturedAt: string
      databaseBytes: string
      limitBytes: string
      utilizationPercent: string
      thresholdState:
        'normal' | 'warning_60' | 'archive_75' | 'block_raw_85' | 'pause_90'
      largestRelations: readonly {
        schema: string
        relation: string
        totalBytes: string
      }[]
      growth7Bytes: string
      growth30Bytes: string
      forecastDays: Record<
        'warning_60' | 'archive_75' | 'block_raw_85' | 'pause_90',
        string | null
      >
      lastCleanupAt: string | null
      lastCleanupCount: number
    }

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Hosted storage status is invalid')
  }
  return value as Record<string, unknown>
}

function text(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Hosted storage status text is invalid')
  }
  return value
}

function decimalText(value: unknown): string {
  const parsed = text(value)
  if (!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(parsed)) {
    throw new Error('Hosted storage status decimal is invalid')
  }
  return parsed
}

export function mapHostedStorageStatus(value: unknown): HostedStorageStatus {
  const data = record(value)
  if (data.available === false) {
    return { available: false, reason: text(data.reason) }
  }
  if (data.available !== true || !Array.isArray(data.largest_relations)) {
    throw new Error('Hosted storage status availability is invalid')
  }
  const thresholdState = text(data.threshold_state)
  if (
    ![
      'normal',
      'warning_60',
      'archive_75',
      'block_raw_85',
      'pause_90',
    ].includes(thresholdState)
  ) {
    throw new Error('Hosted storage threshold state is invalid')
  }
  const forecasts = record(data.forecast_days)
  const forecast = (key: string) => {
    const item = forecasts[key]
    return item === null ? null : decimalText(item)
  }
  return {
    available: true,
    capturedAt: text(data.captured_at),
    databaseBytes: decimalText(data.database_bytes),
    limitBytes: decimalText(data.limit_bytes),
    utilizationPercent: decimalText(data.utilization_percent),
    thresholdState: thresholdState as Extract<
      HostedStorageStatus,
      { available: true }
    >['thresholdState'],
    largestRelations: data.largest_relations.map((item) => {
      const relation = record(item)
      return {
        schema: text(relation.schema),
        relation: text(relation.relation),
        totalBytes: decimalText(relation.total_bytes),
      }
    }),
    growth7Bytes: decimalText(data.growth_7_bytes),
    growth30Bytes: decimalText(data.growth_30_bytes),
    forecastDays: {
      warning_60: forecast('warning_60'),
      archive_75: forecast('archive_75'),
      block_raw_85: forecast('block_raw_85'),
      pause_90: forecast('pause_90'),
    },
    lastCleanupAt:
      data.last_cleanup_at === null ? null : text(data.last_cleanup_at),
    lastCleanupCount:
      typeof data.last_cleanup_count === 'number' &&
      Number.isSafeInteger(data.last_cleanup_count) &&
      data.last_cleanup_count >= 0
        ? data.last_cleanup_count
        : 0,
  }
}

export async function readHostedStorageStatusWithClient(
  client: SupabaseClient<Database>,
): Promise<HostedStorageStatus> {
  const query = client.rpc(
    'hosted_storage_status' as keyof Database['public']['Functions'],
  ) as unknown as Promise<{ data: unknown; error: unknown }>
  const { data, error } = await query
  if (error) throw new Error('Hosted storage status read failed')
  return mapHostedStorageStatus(data)
}

export async function readHostedStorageStatus(): Promise<HostedStorageStatus> {
  const client = await createSupabaseServerClient()
  if (!client) throw new Error('Hosted storage status client is unavailable')
  return readHostedStorageStatusWithClient(client)
}
