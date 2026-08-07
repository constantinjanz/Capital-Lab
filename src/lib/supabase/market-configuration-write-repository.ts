import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import {
  mapHostedMarketConfigurationResult,
  type HostedMarketConfigurationInput,
  type HostedMarketConfigurationResult,
} from '@/features/markets/configure-hosted-market'
import type { Database } from '@/lib/supabase/database.types'

const DEFINITE_REJECTION_CODES = new Set([
  '22023',
  '23505',
  '23514',
  '42501',
  '55000',
])

type RpcError = { code?: string } | null

export type HostedMarketConfigurationWriteResult =
  | ({ ok: true } & HostedMarketConfigurationResult)
  | { ok: false; reason: 'rejected' | 'unknown' }

export async function writeHostedMarketConfiguration(
  supabase: SupabaseClient<Database>,
  input: HostedMarketConfigurationInput,
): Promise<HostedMarketConfigurationWriteResult> {
  let response: {
    data: unknown
    error: RpcError
  }
  try {
    response = await supabase.rpc('configure_hosted_market_manifest', {
      p_operation_id: input.operationId,
    })
  } catch {
    return { ok: false, reason: 'unknown' }
  }

  if (response.error) {
    return {
      ok: false,
      reason:
        response.error.code && DEFINITE_REJECTION_CODES.has(response.error.code)
          ? 'rejected'
          : 'unknown',
    }
  }

  const result = mapHostedMarketConfigurationResult(
    response.data,
    input.operationId,
  )
  if (!result) return { ok: false, reason: 'unknown' }

  return { ok: true, ...result }
}
