import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import {
  mapHostedOfficialCalendarConfigurationResult,
  type HostedOfficialCalendarConfigurationInput,
  type HostedOfficialCalendarConfigurationResult,
} from '@/features/markets/hosted-official-calendar'
import type { Database } from '@/lib/supabase/database.types'

const DEFINITE_REJECTION_CODES = new Set([
  '22023',
  '23505',
  '23514',
  '42501',
  '55000',
])

type RpcError = { code?: string } | null

export type HostedOfficialCalendarConfigurationWriteResult =
  | ({ ok: true } & HostedOfficialCalendarConfigurationResult)
  | { ok: false; reason: 'rejected' | 'unknown' }

export async function writeHostedOfficialCalendarConfiguration(
  supabase: SupabaseClient<Database>,
  input: HostedOfficialCalendarConfigurationInput,
): Promise<HostedOfficialCalendarConfigurationWriteResult> {
  let response: { data: unknown; error: RpcError }
  try {
    response = await supabase.rpc(
      'configure_hosted_official_calendar_manifest',
      { p_operation_id: input.operationId },
    )
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

  const result = mapHostedOfficialCalendarConfigurationResult(
    response.data,
    input.operationId,
  )
  return result ? { ok: true, ...result } : { ok: false, reason: 'unknown' }
}
