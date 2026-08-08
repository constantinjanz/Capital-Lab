import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import {
  mapHostedLearningSnapshotResult,
  type HostedLearningSnapshot,
} from '@/features/memory/hosted-learning-snapshot'
import { createSupabaseServerClient } from '@/lib/auth/supabase/server'
import { log } from '@/lib/logging/logger'
import type { Database } from '@/lib/supabase/database.types'

export type HostedLearningSnapshotClient = SupabaseClient<Database>

type ReadOperation = 'learning_read' | 'learning_validation'

class HostedLearningSnapshotInternalError extends Error {
  constructor(readonly operation: ReadOperation) {
    super('Hosted learning snapshot read failed')
    this.name = 'HostedLearningSnapshotInternalError'
  }
}

async function readWithClient(
  supabase: HostedLearningSnapshotClient,
  ownerId: string,
  decisionAt: string,
): Promise<HostedLearningSnapshot> {
  let result: { data: unknown; error: unknown }
  try {
    result = await supabase.rpc('hosted_learning_snapshot', {
      p_decision_at: decisionAt,
      p_pattern_limit: 100,
    })
  } catch {
    throw new HostedLearningSnapshotInternalError('learning_read')
  }
  if (result.error) {
    throw new HostedLearningSnapshotInternalError('learning_read')
  }

  try {
    return mapHostedLearningSnapshotResult(result.data, ownerId, decisionAt)
  } catch {
    throw new HostedLearningSnapshotInternalError('learning_validation')
  }
}

export async function readHostedLearningSnapshot(
  ownerId: string,
  decisionAt: string,
): Promise<HostedLearningSnapshot> {
  const supabase = await createSupabaseServerClient()
  if (!supabase) throw new Error('Hosted learning snapshot read failed')
  return readHostedLearningSnapshotWithClient(supabase, ownerId, decisionAt)
}

export async function readHostedLearningSnapshotWithClient(
  supabase: HostedLearningSnapshotClient,
  ownerId: string,
  decisionAt: string,
): Promise<HostedLearningSnapshot> {
  try {
    return await readWithClient(supabase, ownerId, decisionAt)
  } catch (error) {
    const operation =
      error instanceof HostedLearningSnapshotInternalError
        ? error.operation
        : 'learning_read'
    log('error', 'Hosted learning snapshot read failed', {
      operation,
      errorClass: error instanceof Error ? error.name : 'UnknownThrownValue',
    })
    throw new Error('Hosted learning snapshot read failed')
  }
}
