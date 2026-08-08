import { describe, expect, it, vi } from 'vitest'

import { readHostedManualCycleStateWithClient } from './manual-cycle-repository'

const experimentId = 'e5000000-0000-4000-8000-000000000001'

describe('hosted manual cycle read repository', () => {
  it('calls only the owner-derived state RPC with the experiment reference', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          experiment_id: experimentId,
          decision_at: '2026-08-08T15:45:02.000+00:00',
          control_state_version: '1',
          scheduler_provider: 'manual',
          ready: true,
          reason: null,
          last_scheduler_run_id: null,
          last_simulator_run_id: null,
          last_slot_key: null,
          last_status: null,
          last_reason: null,
          last_decision_at: null,
        },
      ],
      error: null,
    })

    await expect(
      readHostedManualCycleStateWithClient({ rpc } as never, experimentId),
    ).resolves.toMatchObject({
      status: 'available',
      experimentId,
      ready: true,
    })
    expect(rpc).toHaveBeenCalledWith('hosted_manual_cycle_state', {
      p_experiment_id: experimentId,
    })
  })

  it.each([
    { data: [], error: null },
    { data: null, error: { code: '42501', message: 'raw detail' } },
    { data: [{ experiment_id: 'not-a-uuid' }], error: null },
  ])('fails closed on unavailable or malformed state %#', async (response) => {
    const rpc = vi.fn().mockResolvedValue(response)
    await expect(
      readHostedManualCycleStateWithClient({ rpc } as never, experimentId),
    ).resolves.toEqual({ status: 'unavailable' })
  })
})
