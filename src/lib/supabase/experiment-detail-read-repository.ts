import 'server-only'

import { cache } from 'react'

import { mapHostedExperimentDetail } from '@/features/experiments/hosted-experiment-detail'
import type { HostedExperimentDetail } from '@/features/experiments/hosted-experiment-detail'
import { createSupabaseServerClient } from '@/lib/auth/supabase/server'

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
          'id,from_status,to_status,reason_code,reason,actor_type,correlation_id,occurred_at',
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
