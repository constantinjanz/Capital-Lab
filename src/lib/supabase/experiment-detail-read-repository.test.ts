import { describe, expect, it, vi } from 'vitest'

import { readHostedExperimentStartReadinessWithClient } from './experiment-detail-read-repository'

const experimentId = 'e4000000-0000-4000-8000-000000000001'

function readyRow() {
  return {
    experiment_id: experimentId,
    decision_at: '2026-08-08T10:00:00.000Z',
    draft_revision: '9007199254740993',
    control_state_version: '9007199254740994',
    draft_ready: true,
    start_manifest_id: 'capital_lab_disabled_runtime_start_v1',
    market_manifest_id: 'capital_lab_us_core_alpaca_iex_v1',
    universe_id: 'e4000000-0000-4000-8000-000000000002',
    calendar_manifest_id: 'capital_lab_us_equities_calendar_2026_v1',
    calendar_manifest_record_id: 'e4000000-0000-4000-8000-000000000003',
    ready: true,
  }
}

describe('hosted experiment start readiness repository', () => {
  it('calls only the owner-authorized readiness RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [readyRow()], error: null })

    await expect(
      readHostedExperimentStartReadinessWithClient(
        { rpc } as never,
        experimentId,
      ),
    ).resolves.toMatchObject({
      status: 'available',
      experimentId,
      draftRevision: '9007199254740993',
      controlStateVersion: '9007199254740994',
      ready: true,
    })
    expect(rpc).toHaveBeenCalledWith('hosted_experiment_start_readiness', {
      p_experiment_id: experimentId,
    })
  })

  it.each([
    { data: null, error: { message: 'raw RPC detail' } },
    { data: [], error: null },
    { data: [readyRow(), readyRow()], error: null },
    {
      data: [{ ...readyRow(), experiment_id: 'not-the-requested-id' }],
      error: null,
    },
    {
      data: [{ ...readyRow(), start_manifest_id: 'unreviewed' }],
      error: null,
    },
    {
      data: [{ ...readyRow(), calendar_manifest_record_id: null }],
      error: null,
    },
  ])(
    'fails closed for an unavailable or invalid response',
    async (response) => {
      const rpc = vi.fn().mockResolvedValue(response)

      await expect(
        readHostedExperimentStartReadinessWithClient(
          { rpc } as never,
          experimentId,
        ),
      ).resolves.toEqual({ status: 'unavailable' })
    },
  )

  it('fails closed for a thrown transport error', async () => {
    const rpc = vi.fn().mockRejectedValue(new Error('raw transport detail'))

    await expect(
      readHostedExperimentStartReadinessWithClient(
        { rpc } as never,
        experimentId,
      ),
    ).resolves.toEqual({ status: 'unavailable' })
  })
})
