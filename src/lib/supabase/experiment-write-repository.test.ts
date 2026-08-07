import { describe, expect, it, vi } from 'vitest'

import { createHostedDraftExperiment } from './experiment-write-repository'

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
})
