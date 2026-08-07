import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { mapHostedMarketReadResult } from '@/features/markets/hosted-market-snapshot'
import type { HostedMarketSnapshot } from '@/features/markets/hosted-market-snapshot'
import { createSupabaseServerClient } from '@/lib/auth/supabase/server'
import { log } from '@/lib/logging/logger'
import type { Database } from '@/lib/supabase/database.types'

export type HostedMarketSnapshotClient = SupabaseClient<Database>

type ReadOperation = 'snapshot_read' | 'snapshot_validation'

class HostedMarketSnapshotInternalError extends Error {
  constructor(readonly operation: ReadOperation) {
    super('Hosted market snapshot internal read failed')
    this.name = 'HostedMarketSnapshotInternalError'
  }
}

async function readWithClient(
  supabase: HostedMarketSnapshotClient,
  ownerId: string,
): Promise<HostedMarketSnapshot> {
  let result
  try {
    result = await supabase.rpc('market_snapshot_read', {
      p_session_limit: 5,
      p_timeframe: '1m',
    })
  } catch {
    throw new HostedMarketSnapshotInternalError('snapshot_read')
  }
  if (result.error) {
    throw new HostedMarketSnapshotInternalError('snapshot_read')
  }

  try {
    return mapHostedMarketReadResult(result.data, ownerId)
  } catch {
    throw new HostedMarketSnapshotInternalError('snapshot_validation')
  }
}

export async function readHostedMarketSnapshotWithClient(
  supabase: HostedMarketSnapshotClient,
  ownerId: string,
): Promise<HostedMarketSnapshot> {
  try {
    return await readWithClient(supabase, ownerId)
  } catch (error) {
    log('error', 'Hosted market snapshot read failed', {
      operation:
        error instanceof HostedMarketSnapshotInternalError
          ? error.operation
          : 'unknown',
      errorClass: error instanceof Error ? error.name : 'UnknownThrownValue',
    })
    throw new Error('Hosted market snapshot read failed')
  }
}

export async function readHostedMarketSnapshot(
  ownerId: string,
): Promise<HostedMarketSnapshot> {
  const supabase = await createSupabaseServerClient()
  if (!supabase) throw new Error('Hosted market snapshot read failed')
  return readHostedMarketSnapshotWithClient(supabase, ownerId)
}
