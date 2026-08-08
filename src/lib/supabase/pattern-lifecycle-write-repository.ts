import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import {
  mapHostedPatternReviewResult,
  type HostedPatternReviewInput,
  type HostedPatternReviewResult,
} from '@/features/memory/hosted-pattern-review'
import type { Database } from '@/lib/supabase/database.types'

const DEFINITE_REJECTION_CODES = new Set([
  '22023',
  '23505',
  '23514',
  '40001',
  '42501',
  '55000',
])

type RpcError = { code?: string } | null

export type HostedPatternLifecycleWriteResult =
  | { ok: true; result: HostedPatternReviewResult }
  | { ok: false; reason: 'rejected' | 'unknown' }

export async function writeHostedPatternLifecycleReview(
  supabase: SupabaseClient<Database>,
  input: HostedPatternReviewInput,
): Promise<HostedPatternLifecycleWriteResult> {
  let response: { data: unknown; error: RpcError }
  try {
    response = await supabase.rpc('review_hosted_pattern_lifecycle', {
      p_action: input.action,
      p_confirmation: input.confirmation,
      p_expected_status: input.expectedStatus,
      p_operation_id: input.operationId,
      p_pattern_id: input.patternId,
      ...(input.reason === null ? {} : { p_reason: input.reason }),
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

  const result = mapHostedPatternReviewResult(
    response.data,
    input.patternId,
    input.action,
  )
  return result ? { ok: true, result } : { ok: false, reason: 'unknown' }
}
