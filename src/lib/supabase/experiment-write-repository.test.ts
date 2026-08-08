import { describe, expect, it, vi } from 'vitest'

import {
  createHostedDraftExperiment,
  mutateHostedLockedExperimentLifecycle,
  startHostedDraftExperiment,
  updateHostedDraftExperiment,
} from './experiment-write-repository'

const input = {
  operationId: 'd1000000-0000-4000-8000-000000000001',
  name: 'Hosted event study',
  objective: 'Evaluate a point-in-time event hypothesis safely.',
}

const startInput = {
  operationId: 'd4000000-0000-4000-8000-000000000001',
  experimentId: 'e4000000-0000-4000-8000-000000000001',
  expectedDraftRevision: '9007199254740993',
  expectedControlStateVersion: '9007199254740994',
  mode: 'replay' as const,
  confirmation: 'START REPLAY',
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

  it('calls the lifecycle RPC without caller identity or unused fields', async () => {
    const lifecycleInput = {
      operationId: 'd3000000-0000-4000-8000-000000000001',
      experimentId: 'e3000000-0000-4000-8000-000000000001',
      expectedControlStateVersion: '9007199254740993',
      action: 'pause' as const,
      reason: 'Owner review',
      confirmation: null,
      lockedVersionId: null,
      cloneName: null,
    }
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          experiment_id: lifecycleInput.experimentId,
          source_experiment_id: null,
          lifecycle_status: 'paused',
          execution_mode: 'shadow',
          control_state_version: '9007199254740994',
          replayed: false,
        },
      ],
      error: null,
    })

    await expect(
      mutateHostedLockedExperimentLifecycle({ rpc } as never, lifecycleInput),
    ).resolves.toEqual({
      ok: true,
      result: {
        experimentId: lifecycleInput.experimentId,
        sourceExperimentId: null,
        lifecycleStatus: 'paused',
        executionMode: 'shadow',
        controlStateVersion: '9007199254740994',
        replayed: false,
      },
    })
    expect(rpc).toHaveBeenCalledWith('mutate_locked_experiment_lifecycle', {
      p_action: 'pause',
      p_expected_control_state_version: '9007199254740993',
      p_experiment_id: lifecycleInput.experimentId,
      p_operation_id: lifecycleInput.operationId,
      p_reason: 'Owner review',
    })
  })

  it('maps clone provenance and immutable replay output', async () => {
    const sourceExperimentId = 'e3000000-0000-4000-8000-000000000001'
    const cloneExperimentId = 'e3000000-0000-4000-8000-000000000002'
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          experiment_id: cloneExperimentId,
          source_experiment_id: sourceExperimentId,
          lifecycle_status: 'draft',
          execution_mode: null,
          control_state_version: '0',
          replayed: true,
        },
      ],
      error: null,
    })

    await expect(
      mutateHostedLockedExperimentLifecycle({ rpc } as never, {
        operationId: 'd3000000-0000-4000-8000-000000000002',
        experimentId: sourceExperimentId,
        expectedControlStateVersion: '4',
        action: 'clone',
        reason: null,
        confirmation: null,
        lockedVersionId: null,
        cloneName: 'Next paper draft',
      }),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        experimentId: cloneExperimentId,
        sourceExperimentId,
        lifecycleStatus: 'draft',
        executionMode: null,
        replayed: true,
      },
    })
  })

  it.each([
    ['40001', 'conflict'],
    ['22023', 'invalid'],
    ['55000', 'transition'],
    ['42501', 'rejected'],
    ['PGRST000', 'unknown'],
  ] as const)(
    'maps lifecycle database error %s to %s',
    async (code, reason) => {
      const rpc = vi.fn().mockResolvedValue({
        data: null,
        error: { code, message: 'raw database detail' },
      })

      await expect(
        mutateHostedLockedExperimentLifecycle({ rpc } as never, {
          operationId: 'd3000000-0000-4000-8000-000000000003',
          experimentId: 'e3000000-0000-4000-8000-000000000001',
          expectedControlStateVersion: '0',
          action: 'resume',
          reason: null,
          confirmation: null,
          lockedVersionId: null,
          cloneName: null,
        }),
      ).resolves.toEqual({ ok: false, reason })
    },
  )

  it.each([
    { data: [] },
    {
      data: [
        {
          experiment_id: 'e3000000-0000-4000-8000-000000000001',
          source_experiment_id: null,
          lifecycle_status: 'active',
          execution_mode: 'shadow',
          control_state_version: '1',
          replayed: false,
        },
      ],
    },
    {
      data: [
        {
          experiment_id: 'not-a-uuid',
          source_experiment_id: null,
          lifecycle_status: 'paused',
          execution_mode: 'shadow',
          control_state_version: '1',
          replayed: false,
        },
      ],
    },
  ])('fails closed on malformed lifecycle output', async ({ data }) => {
    const rpc = vi.fn().mockResolvedValue({ data, error: null })

    await expect(
      mutateHostedLockedExperimentLifecycle({ rpc } as never, {
        operationId: 'd3000000-0000-4000-8000-000000000004',
        experimentId: 'e3000000-0000-4000-8000-000000000001',
        expectedControlStateVersion: '0',
        action: 'pause',
        reason: 'Owner review',
        confirmation: null,
        lockedVersionId: null,
        cloneName: null,
      }),
    ).resolves.toEqual({ ok: false, reason: 'unknown' })
  })

  it('calls only the strict hosted start RPC boundary', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          experiment_id: startInput.experimentId,
          experiment_version_id: 'e4000000-0000-4000-8000-000000000002',
          simulation_account_id: 'e4000000-0000-4000-8000-000000000003',
          lifecycle_status: 'active',
          execution_mode: 'replay',
          control_state_version: '9007199254740995',
          replayed: false,
        },
      ],
      error: null,
    })

    await expect(
      startHostedDraftExperiment({ rpc } as never, startInput),
    ).resolves.toEqual({
      ok: true,
      result: {
        experimentId: startInput.experimentId,
        experimentVersionId: 'e4000000-0000-4000-8000-000000000002',
        simulationAccountId: 'e4000000-0000-4000-8000-000000000003',
        lifecycleStatus: 'active',
        executionMode: 'replay',
        controlStateVersion: '9007199254740995',
        replayed: false,
      },
    })
    expect(rpc).toHaveBeenCalledWith('start_hosted_draft_experiment', {
      p_confirmation: 'START REPLAY',
      p_expected_control_state_version: '9007199254740994',
      p_expected_draft_revision: '9007199254740993',
      p_experiment_id: startInput.experimentId,
      p_mode: 'replay',
      p_operation_id: startInput.operationId,
    })
  })

  it.each([
    ['40001', 'conflict'],
    ['22023', 'invalid'],
    ['55000', 'transition'],
    ['42501', 'rejected'],
    ['PGRST000', 'unknown'],
  ] as const)('maps start database error %s to %s', async (code, reason) => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code, message: 'raw database detail' },
    })

    await expect(
      startHostedDraftExperiment({ rpc } as never, startInput),
    ).resolves.toEqual({ ok: false, reason })
  })

  it.each([
    { data: [] },
    {
      data: [
        {
          experiment_id: startInput.experimentId,
          experiment_version_id: 'not-a-uuid',
          simulation_account_id: 'e4000000-0000-4000-8000-000000000003',
          lifecycle_status: 'active',
          execution_mode: 'replay',
          control_state_version: '1',
          replayed: false,
        },
      ],
    },
    {
      data: [
        {
          experiment_id: startInput.experimentId,
          experiment_version_id: 'e4000000-0000-4000-8000-000000000002',
          simulation_account_id: 'e4000000-0000-4000-8000-000000000003',
          lifecycle_status: 'active',
          execution_mode: 'shadow',
          control_state_version: '1',
          replayed: false,
        },
      ],
    },
    {
      data: [
        {
          experiment_id: startInput.experimentId,
          experiment_version_id: 'e4000000-0000-4000-8000-000000000002',
          simulation_account_id: 'e4000000-0000-4000-8000-000000000003',
          lifecycle_status: 'active',
          execution_mode: 'replay',
          control_state_version: '01',
          replayed: false,
        },
      ],
    },
  ])('fails closed on malformed start output', async ({ data }) => {
    const rpc = vi.fn().mockResolvedValue({ data, error: null })

    await expect(
      startHostedDraftExperiment({ rpc } as never, startInput),
    ).resolves.toEqual({ ok: false, reason: 'unknown' })
  })

  it('treats a mismatched experiment result as unknown', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          experiment_id: 'e4000000-0000-4000-8000-000000000099',
          experiment_version_id: 'e4000000-0000-4000-8000-000000000002',
          simulation_account_id: 'e4000000-0000-4000-8000-000000000003',
          lifecycle_status: 'active',
          execution_mode: 'replay',
          control_state_version: '1',
          replayed: true,
        },
      ],
      error: null,
    })

    await expect(
      startHostedDraftExperiment({ rpc } as never, startInput),
    ).resolves.toEqual({ ok: false, reason: 'unknown' })
  })
})
