import 'server-only'

import { cache } from 'react'

import { mapSupabaseWorkspace } from '@/features/workspace/map-supabase-workspace'
import type { WorkspaceReadModel } from '@/features/workspace/types'
import { createSupabaseServerClient } from '@/lib/auth/supabase/server'
import { mockRepository } from '@/lib/mock/repository'

export const readWorkspace = cache(
  async (
    mode: 'mock' | 'supabase',
    ownerId: string,
    ownerEmail: string,
  ): Promise<WorkspaceReadModel> => {
    if (mode === 'mock') {
      return { source: 'mock', shell: mockRepository.getShell() }
    }

    const supabase = await createSupabaseServerClient()
    if (!supabase) throw new Error('Hosted workspace client is unavailable')

    const [experimentsResult, controlsResult] = await Promise.all([
      supabase
        .from('experiments')
        .select(
          'id,name,objective,lifecycle_status,execution_mode,starts_at,created_at,updated_at',
        )
        .eq('owner_id', ownerId)
        .order('updated_at', { ascending: false }),
      supabase
        .from('experiment_controls')
        .select(
          'experiment_id,scheduler_enabled,agent_enabled,emergency_paused,pause_reason',
        )
        .eq('owner_id', ownerId),
    ])

    if (experimentsResult.error || controlsResult.error) {
      throw new Error('Hosted workspace read failed')
    }

    return mapSupabaseWorkspace(experimentsResult.data, controlsResult.data, {
      email: ownerEmail,
    })
  },
)
