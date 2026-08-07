import type {
  HostedExecutionMode,
  HostedLifecycleStatus,
} from '@/features/workspace/types'

export type HostedStatusEventActor = 'owner' | 'scheduler' | 'system'

export interface HostedExperimentDetailRow {
  id: string | null
  owner_id: string | null
  name: string | null
  lifecycle_status: string | null
  execution_mode: string | null
  base_currency: string | null
  initial_capital: string | null
  objective: string | null
  starts_at: string | null
  ends_at: string | null
  lifecycle_pause_reason: string | null
  locked_at: string | null
  locked_version_id: string | null
  created_at: string | null
  updated_at: string | null
  scheduler_enabled: boolean | null
  agent_enabled: boolean | null
  emergency_paused: boolean | null
  control_pause_reason: string | null
  control_state_version: string | null
  locked_version: number | null
  locked_initial_capital: string | null
  locked_base_currency: string | null
  locked_objective: string | null
  locked_version_content_hash: string | null
  market_universe_id: string | null
  simulator_config_version_id: string | null
  risk_config_version_id: string | null
  model_routing_version_id: string | null
  data_source_config_version_id: string | null
  agent_prompt_version_id: string | null
  knowledge_corpus_version_id: string | null
  budget_policy_id: string | null
  locked_version_created_at: string | null
  draft_revision: string | null
}

export interface HostedExperimentStatusEventRow {
  id: string
  from_status: string | null
  to_status: string
  reason_code: string | null
  reason: string | null
  actor_type: string
  correlation_id: string
  occurred_at: string
}

export interface HostedExperimentDetail {
  id: string
  ownerId: string
  name: string
  lifecycleStatus: HostedLifecycleStatus
  executionMode: HostedExecutionMode
  baseCurrency: string
  initialCapital: string
  objective: string
  startsAt: string | null
  endsAt: string | null
  pauseReason: string | null
  lockedAt: string | null
  lockedVersionId: string | null
  createdAt: string
  updatedAt: string
  draftRevision: string
  controls: {
    schedulerEnabled: boolean
    agentEnabled: boolean
    emergencyPaused: boolean
    pauseReason: string | null
    stateVersion: string
  } | null
  lockedVersion: {
    version: number
    initialCapital: string
    baseCurrency: string
    objective: string
    contentHash: string
    createdAt: string
    references: Array<{ label: string; value: string }>
  } | null
  statusEvents: Array<{
    id: string
    fromStatus: HostedLifecycleStatus | null
    toStatus: HostedLifecycleStatus
    reasonCode: string
    reason: string | null
    actorType: HostedStatusEventActor
    correlationId: string
    occurredAt: string
  }>
}

export function isHostedDraftMetadataEditable(
  experiment: HostedExperimentDetail,
): boolean {
  return (
    experiment.lifecycleStatus === 'draft' &&
    experiment.executionMode === null &&
    experiment.startsAt === null &&
    experiment.endsAt === null &&
    experiment.pauseReason === null &&
    experiment.lockedAt === null &&
    experiment.lockedVersionId === null &&
    experiment.controls !== null &&
    !experiment.controls.schedulerEnabled &&
    !experiment.controls.agentEnabled &&
    !experiment.controls.emergencyPaused &&
    experiment.controls.pauseReason === null
  )
}

const lifecycleStatuses = new Set<HostedLifecycleStatus>([
  'draft',
  'starting',
  'active',
  'paused',
  'completed',
  'failed',
])
const executionModes = new Set<Exclude<HostedExecutionMode, null>>([
  'replay',
  'shadow',
  'live_paper',
])
const eventActors = new Set<HostedStatusEventActor>([
  'owner',
  'scheduler',
  'system',
])

function required(value: string | null, field: string): string {
  if (!value) throw new Error(`Hosted experiment detail is missing ${field}`)
  return value
}

function exactNonnegativeInteger(value: string | null, field: string): string {
  const result = required(value, field)
  if (!/^(0|[1-9][0-9]*)$/.test(result)) {
    throw new Error(`Hosted experiment detail has an invalid ${field}`)
  }
  return result
}

function lifecycleStatus(value: string | null): HostedLifecycleStatus {
  if (!value || !lifecycleStatuses.has(value as HostedLifecycleStatus)) {
    throw new Error(
      'Hosted experiment detail has an unsupported lifecycle state',
    )
  }
  return value as HostedLifecycleStatus
}

function executionMode(value: string | null): HostedExecutionMode {
  if (value === null) return null
  if (!executionModes.has(value as Exclude<HostedExecutionMode, null>)) {
    throw new Error(
      'Hosted experiment detail has an unsupported execution mode',
    )
  }
  return value as Exclude<HostedExecutionMode, null>
}

function optionalReference(label: string, value: string | null) {
  return value ? [{ label, value }] : []
}

export function mapHostedExperimentDetail(
  row: HostedExperimentDetailRow,
  eventRows: HostedExperimentStatusEventRow[],
): HostedExperimentDetail {
  const hasControls = row.control_state_version !== null
  if (
    hasControls !==
    [row.scheduler_enabled, row.agent_enabled, row.emergency_paused].every(
      (value) => value !== null,
    )
  ) {
    throw new Error('Hosted experiment detail has partial control state')
  }

  const hasLockedVersion = row.locked_version_id !== null
  const lockedVersionRequired = [
    row.locked_version,
    row.locked_initial_capital,
    row.locked_base_currency,
    row.locked_objective,
    row.locked_version_content_hash,
    row.market_universe_id,
    row.simulator_config_version_id,
    row.risk_config_version_id,
    row.model_routing_version_id,
    row.data_source_config_version_id,
    row.locked_version_created_at,
  ]
  if (
    hasLockedVersion !== lockedVersionRequired.every((value) => value !== null)
  ) {
    throw new Error('Hosted experiment detail has a partial locked version')
  }

  return {
    id: required(row.id, 'id'),
    ownerId: required(row.owner_id, 'owner id'),
    name: required(row.name, 'name'),
    lifecycleStatus: lifecycleStatus(row.lifecycle_status),
    executionMode: executionMode(row.execution_mode),
    baseCurrency: required(row.base_currency, 'base currency'),
    initialCapital: required(row.initial_capital, 'initial capital'),
    objective: required(row.objective, 'objective'),
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    pauseReason: row.lifecycle_pause_reason,
    lockedAt: row.locked_at,
    lockedVersionId: row.locked_version_id,
    createdAt: required(row.created_at, 'created timestamp'),
    updatedAt: required(row.updated_at, 'updated timestamp'),
    draftRevision: exactNonnegativeInteger(
      row.draft_revision,
      'draft revision',
    ),
    controls: hasControls
      ? {
          schedulerEnabled: row.scheduler_enabled as boolean,
          agentEnabled: row.agent_enabled as boolean,
          emergencyPaused: row.emergency_paused as boolean,
          pauseReason: row.control_pause_reason,
          stateVersion: row.control_state_version as string,
        }
      : null,
    lockedVersion: hasLockedVersion
      ? {
          version: row.locked_version as number,
          initialCapital: row.locked_initial_capital as string,
          baseCurrency: row.locked_base_currency as string,
          objective: row.locked_objective as string,
          contentHash: row.locked_version_content_hash as string,
          createdAt: row.locked_version_created_at as string,
          references: [
            {
              label: 'Market universe',
              value: row.market_universe_id as string,
            },
            {
              label: 'Simulator config',
              value: row.simulator_config_version_id as string,
            },
            {
              label: 'Risk config',
              value: row.risk_config_version_id as string,
            },
            {
              label: 'Model routing',
              value: row.model_routing_version_id as string,
            },
            {
              label: 'Data source config',
              value: row.data_source_config_version_id as string,
            },
            ...optionalReference('Agent prompt', row.agent_prompt_version_id),
            ...optionalReference(
              'Knowledge corpus',
              row.knowledge_corpus_version_id,
            ),
            ...optionalReference('Budget policy', row.budget_policy_id),
          ],
        }
      : null,
    statusEvents: eventRows.map((event) => {
      if (!eventActors.has(event.actor_type as HostedStatusEventActor)) {
        throw new Error('Hosted status event has an unsupported actor type')
      }
      return {
        id: event.id,
        fromStatus:
          event.from_status === null
            ? null
            : lifecycleStatus(event.from_status),
        toStatus: lifecycleStatus(event.to_status),
        reasonCode: required(event.reason_code, 'status event reason code'),
        reason: event.reason,
        actorType: event.actor_type as HostedStatusEventActor,
        correlationId: event.correlation_id,
        occurredAt: event.occurred_at,
      }
    }),
  }
}
