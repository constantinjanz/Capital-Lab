import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { cache } from 'react'

import {
  hostedManualCycleReasons,
  mapHostedManualCycleState,
  type HostedManualCycleInput,
  type HostedManualCycleReason,
  type HostedManualCycleState,
} from '@/features/experiments/hosted-manual-cycle'
import { createSupabaseServerClient } from '@/lib/auth/supabase/server'
import type { Database } from '@/lib/supabase/database.types'

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DEFINITE_REJECTION_CODES = new Set(['22003', '23505', '23514', '42501'])

export type HostedManualCycleResult = {
  schedulerRunId: string
  simulatorRunId: string
  slotKey: string
  decisionAt: string
  status: 'skipped'
  reason: HostedManualCycleReason
  modelCalls: 0
  paperOrdersCreated: 0
  paperFillsCreated: 0
  replayed: boolean
}

export async function readHostedManualCycleStateWithClient(
  supabase: SupabaseClient<Database>,
  experimentId: string,
): Promise<HostedManualCycleState> {
  try {
    const { data, error } = await supabase.rpc('hosted_manual_cycle_state', {
      p_experiment_id: experimentId,
    })
    if (error || !Array.isArray(data) || data.length !== 1) {
      return { status: 'unavailable' }
    }
    return mapHostedManualCycleState(data[0], experimentId)
  } catch {
    return { status: 'unavailable' }
  }
}

export const readHostedManualCycleState = cache(
  async (experimentId: string): Promise<HostedManualCycleState> => {
    const supabase = await createSupabaseServerClient()
    if (!supabase) return { status: 'unavailable' }
    return readHostedManualCycleStateWithClient(supabase, experimentId)
  },
)

export async function runHostedManualCycleMutation(
  supabase: SupabaseClient<Database>,
  input: HostedManualCycleInput,
): Promise<
  | { ok: true; result: HostedManualCycleResult }
  | {
      ok: false
      reason: 'conflict' | 'invalid' | 'transition' | 'rejected' | 'unknown'
    }
> {
  const { data, error } = await supabase.rpc('run_hosted_manual_cycle', {
    p_confirmation: input.confirmation,
    p_decision_at: input.decisionAt,
    p_expected_control_state_version: input.expectedControlStateVersion,
    p_experiment_id: input.experimentId,
    p_operation_id: input.operationId,
  })

  if (error) {
    if (error.code === '40001') return { ok: false, reason: 'conflict' }
    if (error.code === '22023') return { ok: false, reason: 'invalid' }
    if (error.code === '55000') return { ok: false, reason: 'transition' }
    if (DEFINITE_REJECTION_CODES.has(error.code)) {
      return { ok: false, reason: 'rejected' }
    }
    return { ok: false, reason: 'unknown' }
  }

  if (!Array.isArray(data) || data.length !== 1) {
    return { ok: false, reason: 'unknown' }
  }

  const row = data[0]
  if (
    !row ||
    !CANONICAL_UUID.test(row.scheduler_run_id) ||
    !CANONICAL_UUID.test(row.simulator_run_id) ||
    typeof row.slot_key !== 'string' ||
    !row.slot_key
      .toLowerCase()
      .startsWith(`hosted-paper-cycle:${input.experimentId.toLowerCase()}:`) ||
    !Number.isFinite(Date.parse(row.decision_at)) ||
    row.status !== 'skipped' ||
    !hostedManualCycleReasons.includes(row.reason as HostedManualCycleReason) ||
    row.model_calls !== 0 ||
    row.paper_orders_created !== 0 ||
    row.paper_fills_created !== 0 ||
    typeof row.replayed !== 'boolean'
  ) {
    return { ok: false, reason: 'unknown' }
  }

  return {
    ok: true,
    result: {
      schedulerRunId: row.scheduler_run_id,
      simulatorRunId: row.simulator_run_id,
      slotKey: row.slot_key,
      decisionAt: row.decision_at,
      status: 'skipped',
      reason: row.reason as HostedManualCycleReason,
      modelCalls: 0,
      paperOrdersCreated: 0,
      paperFillsCreated: 0,
      replayed: row.replayed,
    },
  }
}
