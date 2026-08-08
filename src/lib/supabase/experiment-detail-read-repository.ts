import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { cache } from 'react'

import { mapHostedExperimentDetail } from '@/features/experiments/hosted-experiment-detail'
import type { HostedExperimentDetail } from '@/features/experiments/hosted-experiment-detail'
import {
  mapHostedExperimentStartReadiness,
  type HostedExperimentStartReadiness,
} from '@/features/experiments/start-hosted-draft'
import { createSupabaseServerClient } from '@/lib/auth/supabase/server'
import type { Database } from '@/lib/supabase/database.types'

export const readHostedExperimentDetail = cache(
  async (
    ownerId: string,
    experimentId: string,
  ): Promise<HostedExperimentDetail | null> => {
    const supabase = await createSupabaseServerClient()
    if (!supabase) throw new Error('Hosted experiment client is unavailable')

    const [detailResult, eventsResult] = await Promise.all([
      supabase
        .from('experiment_detail_read_view')
        .select('*')
        .eq('owner_id', ownerId)
        .eq('id', experimentId)
        .maybeSingle(),
      supabase
        .from('experiment_status_events')
        .select(
          'id,from_status,to_status,from_execution_mode,to_execution_mode,reason_code,reason,actor_type,correlation_id,occurred_at',
        )
        .eq('owner_id', ownerId)
        .eq('experiment_id', experimentId)
        .order('occurred_at', { ascending: false })
        .limit(50),
    ])

    if (detailResult.error || eventsResult.error) {
      throw new Error('Hosted experiment detail read failed')
    }
    if (!detailResult.data) return null

    return mapHostedExperimentDetail(detailResult.data, eventsResult.data)
  },
)

async function readStartReadinessWithClient(
  supabase: SupabaseClient<Database>,
  experimentId: string,
): Promise<HostedExperimentStartReadiness> {
  try {
    const { data, error } = await supabase.rpc(
      'hosted_experiment_start_readiness',
      { p_experiment_id: experimentId },
    )

    if (error || !Array.isArray(data) || data.length !== 1) {
      return { status: 'unavailable' }
    }

    return mapHostedExperimentStartReadiness(data[0], experimentId)
  } catch {
    return { status: 'unavailable' }
  }
}

export async function readHostedExperimentStartReadinessWithClient(
  supabase: SupabaseClient<Database>,
  experimentId: string,
): Promise<HostedExperimentStartReadiness> {
  return readStartReadinessWithClient(supabase, experimentId)
}

export const readHostedExperimentStartReadiness = cache(
  async (experimentId: string): Promise<HostedExperimentStartReadiness> => {
    const supabase = await createSupabaseServerClient()
    if (!supabase) return { status: 'unavailable' }
    return readStartReadinessWithClient(supabase, experimentId)
  },
)
