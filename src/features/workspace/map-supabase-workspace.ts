import type { HostedExperiment, WorkspaceReadModel } from './types'

export interface WorkspaceExperimentRow {
  id: string
  name: string
  objective: string
  lifecycle_status: string
  execution_mode: string | null
  starts_at: string | null
  created_at: string
  updated_at: string
}

export interface WorkspaceControlRow {
  experiment_id: string
  scheduler_enabled: boolean
  agent_enabled: boolean
  emergency_paused: boolean
  pause_reason: string | null
}

const lifecycleStatuses = new Set([
  'draft',
  'starting',
  'active',
  'paused',
  'completed',
  'failed',
])
const executionModes = new Set(['replay', 'shadow', 'live_paper'])

function mapExperiment(
  row: WorkspaceExperimentRow,
  control: WorkspaceControlRow | undefined,
): HostedExperiment {
  if (!lifecycleStatuses.has(row.lifecycle_status)) {
    throw new Error('Hosted experiment has an unsupported lifecycle state')
  }
  if (row.execution_mode !== null && !executionModes.has(row.execution_mode)) {
    throw new Error('Hosted experiment has an unsupported execution mode')
  }
  return {
    id: row.id,
    name: row.name,
    objective: row.objective,
    lifecycleStatus:
      row.lifecycle_status as HostedExperiment['lifecycleStatus'],
    executionMode: row.execution_mode as HostedExperiment['executionMode'],
    startsAt: row.starts_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    controls: control
      ? {
          schedulerEnabled: control.scheduler_enabled,
          agentEnabled: control.agent_enabled,
          emergencyPaused: control.emergency_paused,
          pauseReason: control.pause_reason,
        }
      : null,
  }
}

function currentPriority(experiment: HostedExperiment): number {
  if (experiment.controls?.schedulerEnabled) return 0
  if (experiment.lifecycleStatus === 'active') return 1
  if (experiment.lifecycleStatus === 'starting') return 2
  if (experiment.lifecycleStatus === 'paused') return 3
  if (experiment.lifecycleStatus === 'draft') return 4
  return 5
}

export function hostedExperimentStatusLabel(
  experiment: HostedExperiment,
): string {
  if (
    (experiment.lifecycleStatus === 'active' ||
      experiment.lifecycleStatus === 'starting') &&
    experiment.executionMode
  ) {
    return experiment.executionMode.replace('_', '-')
  }
  return experiment.lifecycleStatus
}

export function mapSupabaseWorkspace(
  experimentRows: WorkspaceExperimentRow[],
  controlRows: WorkspaceControlRow[],
  owner: { email: string },
): Extract<WorkspaceReadModel, { source: 'supabase' }> {
  const controlsByExperiment = new Map(
    controlRows.map((control) => [control.experiment_id, control]),
  )
  const experiments = experimentRows.map((row) =>
    mapExperiment(row, controlsByExperiment.get(row.id)),
  )
  const ranked = experiments.toSorted((left, right) => {
    const priority = currentPriority(left) - currentPriority(right)
    if (priority !== 0) return priority
    return right.updatedAt.localeCompare(left.updatedAt)
  })
  const current = ranked[0] ?? null
  const initials = owner.email.slice(0, 2).toLocaleUpperCase('en-US')

  return {
    source: 'supabase',
    experiments,
    currentExperimentId: current?.id ?? null,
    shell: {
      owner: { name: owner.email, email: owner.email, initials },
      experiments: experiments.map((experiment) => ({
        id: experiment.id,
        name: experiment.name,
        status: hostedExperimentStatusLabel(experiment),
      })),
      currentExperiment: current
        ? {
            id: current.id,
            name: current.name,
            status: hostedExperimentStatusLabel(current),
          }
        : null,
      market: {
        state: 'offline',
        detail: 'Market ingestion disabled',
        asOf: new Date(0).toISOString(),
      },
      dataMode: 'supabase',
      agentMode: current?.controls?.agentEnabled ? 'shadow' : 'disabled',
      scheduler: {
        state: current?.controls?.schedulerEnabled ? 'healthy' : 'disabled',
        detail: current?.controls?.schedulerEnabled
          ? 'Enabled in database controls'
          : 'Remote cycles are off',
      },
      spend: { state: 'not_connected' },
    },
  }
}
