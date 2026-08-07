import { describe, expect, it, vi } from 'vitest'

import {
  createHostedDraftExperiment,
  updateHostedDraftExperiment,
} from './experiment-write-repository'

const input = {
  operationId: 'd1000000-0000-4000-8000-000000000001',
  name: 'Hosted event study',
  objective: 'Evaluate a point-in-time event hypothesis safely.',
}

describe('hosted experiment write repository', () => {
  it('calls only the narrow RPC with no caller-supplied owner or state', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: 'e1000000-0000-4000-8000-000000000001',
      error: null,
    })

    await expect(
      createHostedDraftExperiment({ rpc } as never, input),
    ).resolves.toEqual({
      ok: true,
      experimentId: 'e1000000-0000-4000-8000-000000000001',
    })
    expect(rpc).toHaveBeenCalledWith('create_draft_experiment', {
      p_operation_id: input.operationId,
      p_name: input.name,
      p_objective: input.objective,
    })
  })

  it.each([
    { data: null, error: new Error('raw database detail') },
    { data: 'not-a-uuid', error: null },
  ])('fails closed without exposing malformed RPC output', async (response) => {
    const rpc = vi.fn().mockResolvedValue(response)

    await expect(
      createHostedDraftExperiment({ rpc } as never, input),
    ).resolves.toEqual({ ok: false })
  })

  it('calls only the revisioned draft update RPC fields', async () => {
    const updateInput = {
      operationId: 'd2000000-0000-4000-8000-000000000001',
      experimentId: 'e2000000-0000-4000-8000-000000000001',
      expectedRevision: '9007199254740993',
      name: 'Revised event study',
      objective: 'Evaluate a revised point-in-time hypothesis safely.',
    }
    const rpc = vi.fn().mockResolvedValue({
      data: updateInput.experimentId,
      error: null,
    })

    await expect(
      updateHostedDraftExperiment({ rpc } as never, updateInput),
    ).resolves.toEqual({
      ok: true,
      experimentId: updateInput.experimentId,
    })
    expect(rpc).toHaveBeenCalledWith('update_draft_experiment', {
      p_operation_id: updateInput.operationId,
      p_experiment_id: updateInput.experimentId,
      p_expected_revision: '9007199254740993',
      p_name: updateInput.name,
      p_objective: updateInput.objective,
    })
  })

  it.each([
    ['40001', 'conflict'],
    ['22023', 'invalid'],
    ['42501', 'rejected'],
    ['PGRST000', 'unknown'],
  ] as const)('maps database error %s to %s', async (code, reason) => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code, message: 'raw database detail' },
    })

    await expect(
      updateHostedDraftExperiment({ rpc } as never, {
        operationId: 'd2000000-0000-4000-8000-000000000001',
        experimentId: 'e2000000-0000-4000-8000-000000000001',
        expectedRevision: '0',
        name: 'Revised event study',
        objective: 'Evaluate a revised point-in-time hypothesis safely.',
      }),
    ).resolves.toEqual({ ok: false, reason })
  })

  it.each([
    'E2000000-0000-7000-8000-000000000001',
    'E2000000-0000-8000-8000-000000000001',
  ])(
    'accepts canonical UUID output regardless of input casing or UUID version',
    async (uppercaseExperimentId) => {
      const rpc = vi.fn().mockResolvedValue({
        data: uppercaseExperimentId.toLowerCase(),
        error: null,
      })

      await expect(
        updateHostedDraftExperiment({ rpc } as never, {
          operationId: 'd2000000-0000-4000-8000-000000000001',
          experimentId: uppercaseExperimentId,
          expectedRevision: '0',
          name: 'Revised event study',
          objective: 'Evaluate a revised point-in-time hypothesis safely.',
        }),
      ).resolves.toEqual({
        ok: true,
        experimentId: uppercaseExperimentId.toLowerCase(),
      })
    },
  )

  it.each(['e2000000-0000-4000-8000-000000000999', 'not-a-uuid', null])(
    'treats an unconfirmed experiment result as unknown',
    async (data) => {
      const rpc = vi.fn().mockResolvedValue({
        data,
        error: null,
      })

      await expect(
        updateHostedDraftExperiment({ rpc } as never, {
          operationId: 'd2000000-0000-4000-8000-000000000001',
          experimentId: 'e2000000-0000-4000-8000-000000000001',
          expectedRevision: '0',
          name: 'Revised event study',
          objective: 'Evaluate a revised point-in-time hypothesis safely.',
        }),
      ).resolves.toEqual({ ok: false, reason: 'unknown' })
    },
  )
})
