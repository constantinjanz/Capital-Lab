import { describe, expect, it } from 'vitest'

import { mapSupabaseWorkspace } from './map-supabase-workspace'

const baseExperiment = {
  id: 'draft-id',
  name: 'Draft study',
  objective: 'Test a bounded hypothesis',
  lifecycle_status: 'draft',
  execution_mode: null,
  starts_at: null,
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
}

describe('mapSupabaseWorkspace', () => {
  it('returns a truthful connected empty state', () => {
    const workspace = mapSupabaseWorkspace([], [], {
      email: 'owner@example.com',
    })

    expect(workspace.currentExperimentId).toBeNull()
    expect(workspace.shell.currentExperiment).toBeNull()
    expect(workspace.shell.dataMode).toBe('supabase')
    expect(workspace.shell.market.state).toBe('offline')
    expect(workspace.shell.spend).toEqual({ state: 'not_connected' })
  })

  it('keeps lifecycle and execution mode separate', () => {
    const workspace = mapSupabaseWorkspace(
      [
        {
          ...baseExperiment,
          lifecycle_status: 'active',
          execution_mode: 'shadow',
        },
      ],
      [],
      { email: 'owner@example.com' },
    )

    expect(workspace.experiments[0]).toMatchObject({
      lifecycleStatus: 'active',
      executionMode: 'shadow',
    })
    expect(workspace.shell.currentExperiment?.status).toBe('shadow')
  })

  it('prioritizes a scheduled experiment, then recency', () => {
    const workspace = mapSupabaseWorkspace(
      [
        baseExperiment,
        {
          ...baseExperiment,
          id: 'scheduled-id',
          name: 'Scheduled study',
          updated_at: '2026-07-01T00:00:00.000Z',
        },
      ],
      [
        {
          experiment_id: 'scheduled-id',
          scheduler_enabled: true,
          agent_enabled: false,
          emergency_paused: false,
          pause_reason: null,
        },
      ],
      { email: 'owner@example.com' },
    )

    expect(workspace.currentExperimentId).toBe('scheduled-id')
  })

  it('fails closed for unknown database states', () => {
    expect(() =>
      mapSupabaseWorkspace(
        [{ ...baseExperiment, lifecycle_status: 'unexpected' }],
        [],
        { email: 'owner@example.com' },
      ),
    ).toThrow('unsupported lifecycle state')
  })
})
