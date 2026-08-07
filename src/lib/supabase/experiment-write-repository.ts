import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { HostedDraftInput } from '@/features/experiments/create-hosted-draft'
import type {
  HostedLifecycleAction,
  HostedLifecycleInput,
} from '@/features/experiments/mutate-hosted-lifecycle'
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
const CANONICAL_BIGINT_TEXT = /^(0|[1-9][0-9]*)$/
const LIFECYCLE_STATUSES = new Set(['draft', 'active', 'paused', 'completed'])
const EXECUTION_MODES = new Set(['replay', 'shadow', 'live_paper'])

export type HostedLifecycleMutationResult = {
  experimentId: string
  sourceExperimentId: string | null
  lifecycleStatus: 'draft' | 'active' | 'paused' | 'completed'
  executionMode: 'replay' | 'shadow' | 'live_paper' | null
  controlStateVersion: string
  replayed: boolean
}

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

function resultMatchesAction(
  action: HostedLifecycleAction,
  result: HostedLifecycleMutationResult,
  sourceExperimentId: string,
): boolean {
  if (action === 'promote_live_paper') {
    return (
      result.experimentId.toLowerCase() === sourceExperimentId.toLowerCase() &&
      result.sourceExperimentId === null &&
      result.lifecycleStatus === 'active' &&
      result.executionMode === 'live_paper'
    )
  }
  if (action === 'pause') {
    return (
      result.experimentId.toLowerCase() === sourceExperimentId.toLowerCase() &&
      result.sourceExperimentId === null &&
      result.lifecycleStatus === 'paused' &&
      result.executionMode !== null
    )
  }
  if (action === 'resume') {
    return (
      result.experimentId.toLowerCase() === sourceExperimentId.toLowerCase() &&
      result.sourceExperimentId === null &&
      result.lifecycleStatus === 'active' &&
      result.executionMode !== null
    )
  }
  if (action === 'complete') {
    return (
      result.experimentId.toLowerCase() === sourceExperimentId.toLowerCase() &&
      result.sourceExperimentId === null &&
      result.lifecycleStatus === 'completed' &&
      result.executionMode !== null
    )
  }
  return (
    result.experimentId.toLowerCase() !== sourceExperimentId.toLowerCase() &&
    result.sourceExperimentId?.toLowerCase() ===
      sourceExperimentId.toLowerCase() &&
    result.lifecycleStatus === 'draft' &&
    result.executionMode === null &&
    result.controlStateVersion === '0'
  )
}

export async function mutateHostedLockedExperimentLifecycle(
  supabase: SupabaseClient<Database>,
  input: HostedLifecycleInput,
): Promise<
  | { ok: true; result: HostedLifecycleMutationResult }
  | {
      ok: false
      reason: 'conflict' | 'invalid' | 'transition' | 'rejected' | 'unknown'
    }
> {
  const { data, error } = await supabase.rpc(
    'mutate_locked_experiment_lifecycle',
    {
      p_action: input.action,
      p_expected_control_state_version: input.expectedControlStateVersion,
      p_experiment_id: input.experimentId,
      p_operation_id: input.operationId,
      ...(input.reason ? { p_reason: input.reason } : {}),
      ...(input.confirmation ? { p_confirmation: input.confirmation } : {}),
      ...(input.lockedVersionId
        ? { p_locked_version_id: input.lockedVersionId }
        : {}),
      ...(input.cloneName ? { p_clone_name: input.cloneName } : {}),
    },
  )

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
    !CANONICAL_UUID.test(row.experiment_id) ||
    (row.source_experiment_id !== null &&
      !CANONICAL_UUID.test(row.source_experiment_id)) ||
    !LIFECYCLE_STATUSES.has(row.lifecycle_status) ||
    (row.execution_mode !== null && !EXECUTION_MODES.has(row.execution_mode)) ||
    !CANONICAL_BIGINT_TEXT.test(row.control_state_version) ||
    typeof row.replayed !== 'boolean'
  ) {
    return { ok: false, reason: 'unknown' }
  }

  const result = {
    experimentId: row.experiment_id,
    sourceExperimentId: row.source_experiment_id,
    lifecycleStatus:
      row.lifecycle_status as HostedLifecycleMutationResult['lifecycleStatus'],
    executionMode:
      row.execution_mode as HostedLifecycleMutationResult['executionMode'],
    controlStateVersion: row.control_state_version,
    replayed: row.replayed,
  }

  if (!resultMatchesAction(input.action, result, input.experimentId)) {
    return { ok: false, reason: 'unknown' }
  }

  return { ok: true, result }
}
