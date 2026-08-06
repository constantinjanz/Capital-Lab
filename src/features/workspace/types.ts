import type { ShellViewModel } from '@/lib/mock/types'

export type HostedLifecycleStatus =
  'draft' | 'starting' | 'active' | 'paused' | 'completed' | 'failed'

export type HostedExecutionMode = 'replay' | 'shadow' | 'live_paper' | null

export interface HostedExperiment {
  id: string
  name: string
  objective: string
  lifecycleStatus: HostedLifecycleStatus
  executionMode: HostedExecutionMode
  startsAt: string | null
  createdAt: string
  updatedAt: string
  controls: {
    schedulerEnabled: boolean
    agentEnabled: boolean
    emergencyPaused: boolean
    pauseReason: string | null
    stateVersion: number
  } | null
}

export type WorkspaceReadModel =
  | {
      source: 'mock'
      shell: ShellViewModel
    }
  | {
      source: 'supabase'
      shell: ShellViewModel
      experiments: HostedExperiment[]
      currentExperimentId: string | null
    }
