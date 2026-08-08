import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import {
  mapHostedDecisionMemoryResult,
  type HostedDecisionMemory,
} from '@/features/memory/hosted-decision-memory'
import { createSupabaseServerClient } from '@/lib/auth/supabase/server'
import { log } from '@/lib/logging/logger'
import type { Database } from '@/lib/supabase/database.types'

export type HostedDecisionMemoryClient = SupabaseClient<Database>

type ReadOperation = 'memory_read' | 'memory_validation'
const CLOCK_SKEW_BUFFER_MS = 5_000

class HostedDecisionMemoryInternalError extends Error {
  constructor(readonly operation: ReadOperation) {
    super('Hosted decision memory read failed')
    this.name = 'HostedDecisionMemoryInternalError'
  }
}

export function decisionAtForHostedMemoryRead(): string {
  return new Date(Date.now() - CLOCK_SKEW_BUFFER_MS).toISOString()
}

async function readWithClient(
  supabase: HostedDecisionMemoryClient,
  ownerId: string,
  decisionAt: string,
): Promise<HostedDecisionMemory> {
  let result
  try {
    result = await supabase.rpc('hosted_decision_memory_read', {
      p_context_limit: 100,
      p_decision_at: decisionAt,
    })
  } catch {
    throw new HostedDecisionMemoryInternalError('memory_read')
  }
  if (result.error) {
    throw new HostedDecisionMemoryInternalError('memory_read')
  }

  try {
    return mapHostedDecisionMemoryResult(result.data, ownerId, decisionAt)
  } catch {
    throw new HostedDecisionMemoryInternalError('memory_validation')
  }
}

export async function readHostedDecisionMemory(
  ownerId: string,
  decisionAt: string,
): Promise<HostedDecisionMemory> {
  const supabase = await createSupabaseServerClient()
  if (!supabase) throw new Error('Hosted decision memory read failed')
  return readHostedDecisionMemoryWithClient(supabase, ownerId, decisionAt)
}

export async function readHostedDecisionMemoryWithClient(
  supabase: HostedDecisionMemoryClient,
  ownerId: string,
  decisionAt: string,
): Promise<HostedDecisionMemory> {
  try {
    return await readWithClient(supabase, ownerId, decisionAt)
  } catch (error) {
    const operation =
      error instanceof HostedDecisionMemoryInternalError
        ? error.operation
        : 'memory_read'
    log('error', 'Hosted decision memory read failed', {
      operation,
      errorClass: error instanceof Error ? error.name : 'UnknownThrownValue',
    })
    throw new Error('Hosted decision memory read failed')
  }
}
