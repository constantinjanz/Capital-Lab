import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/lib/supabase/database.types'

export type HostedSchedulerJob = 'market_dispatcher' | 'reconciler'

export type HostedSchedulerRequestResult = {
  status: 'completed' | 'skipped' | 'duplicate'
  reason: string
  cyclesClaimed: number
  cyclesReconciled: number
  modelCalls: 0
  paperOrdersCreated: 0
  paperFillsCreated: 0
  ledgerEntriesCreated: 0
}

type SchedulerClient = SupabaseClient<Database>

function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`Hosted scheduler returned an invalid ${label}`)
  }
  return value as number
}

function exactZero(value: unknown, label: string): 0 {
  if (integer(value, label) !== 0) {
    throw new Error(`Hosted scheduler returned an unsafe ${label}`)
  }
  return 0
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Hosted scheduler returned an invalid ${label}`)
  }
  return value
}

export async function runHostedSchedulerRequest(
  client: SchedulerClient,
  input: {
    job: HostedSchedulerJob
    correlationId: string
    cycleId: string
    requestedAt: string
    signal: AbortSignal
  },
): Promise<HostedSchedulerRequestResult> {
  const query = client.rpc(
    'run_hosted_scheduler_request' as keyof Database['public']['Functions'],
    {
      p_job: input.job,
      p_correlation_id: input.correlationId,
      p_cycle_id: input.cycleId,
      p_requested_at: input.requestedAt,
    } as never,
  ) as unknown as {
    abortSignal(signal: AbortSignal): Promise<{ data: unknown; error: unknown }>
  }
  const { data, error } = await query.abortSignal(input.signal)
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Hosted scheduler database operation failed')
  }
  const record = data as Record<string, unknown>
  const status = text(record.status, 'status')
  if (!['completed', 'skipped', 'duplicate'].includes(status)) {
    throw new Error('Hosted scheduler returned an invalid status')
  }
  return {
    status: status as HostedSchedulerRequestResult['status'],
    reason: text(record.reason, 'reason'),
    cyclesClaimed: integer(record.cycles_claimed, 'claimed-cycle count'),
    cyclesReconciled: integer(
      record.cycles_reconciled,
      'reconciled-cycle count',
    ),
    modelCalls: exactZero(record.model_calls, 'model-call count'),
    paperOrdersCreated: exactZero(
      record.paper_orders_created,
      'paper-order count',
    ),
    paperFillsCreated: exactZero(
      record.paper_fills_created,
      'paper-fill count',
    ),
    ledgerEntriesCreated: exactZero(
      record.ledger_entries_created,
      'ledger-entry count',
    ),
  }
}
