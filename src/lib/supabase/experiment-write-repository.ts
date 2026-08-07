import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { HostedDraftInput } from '@/features/experiments/create-hosted-draft'
import type { HostedDraftUpdateInput } from '@/features/experiments/update-hosted-draft'
import type { Database } from '@/lib/supabase/database.types'

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DEFINITE_REJECTION_CODES = new Set([
  '22003',
  '23505',
  '23514',
  '42501',
  '55000',
])

export async function createHostedDraftExperiment(
  supabase: SupabaseClient<Database>,
  input: HostedDraftInput,
): Promise<{ ok: true; experimentId: string } | { ok: false }> {
  const { data, error } = await supabase.rpc('create_draft_experiment', {
    p_operation_id: input.operationId,
    p_name: input.name,
    p_objective: input.objective,
  })

  if (error || typeof data !== 'string' || !CANONICAL_UUID.test(data)) {
    return { ok: false }
  }

  return { ok: true, experimentId: data }
}

export async function updateHostedDraftExperiment(
  supabase: SupabaseClient<Database>,
  input: HostedDraftUpdateInput,
): Promise<
  | { ok: true; experimentId: string }
  | { ok: false; reason: 'conflict' | 'invalid' | 'rejected' | 'unknown' }
> {
  const { data, error } = await supabase.rpc('update_draft_experiment', {
    p_operation_id: input.operationId,
    p_experiment_id: input.experimentId,
    p_expected_revision: input.expectedRevision,
    p_name: input.name,
    p_objective: input.objective,
  })

  if (error) {
    if (error.code === '40001') return { ok: false, reason: 'conflict' }
    if (error.code === '22023') return { ok: false, reason: 'invalid' }
    if (DEFINITE_REJECTION_CODES.has(error.code)) {
      return { ok: false, reason: 'rejected' }
    }
    return { ok: false, reason: 'unknown' }
  }
  if (
    typeof data !== 'string' ||
    !CANONICAL_UUID.test(data) ||
    data.toLowerCase() !== input.experimentId.toLowerCase()
  ) {
    return { ok: false, reason: 'unknown' }
  }

  return { ok: true, experimentId: data }
}
