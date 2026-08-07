import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { HostedDraftInput } from '@/features/experiments/create-hosted-draft'
import type { Database } from '@/lib/supabase/database.types'

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function createHostedDraftExperiment(
  supabase: SupabaseClient<Database>,
  input: HostedDraftInput,
): Promise<{ ok: true; experimentId: string } | { ok: false }> {
  const { data, error } = await supabase.rpc('create_draft_experiment', {
    p_operation_id: input.operationId,
    p_name: input.name,
    p_objective: input.objective,
  })

  if (error || typeof data !== 'string' || !UUID.test(data)) {
    return { ok: false }
  }

  return { ok: true, experimentId: data }
}
