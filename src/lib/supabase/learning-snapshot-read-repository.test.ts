import { afterEach, describe, expect, it, vi } from 'vitest'

const logMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/logging/logger', () => ({ log: logMock }))

import type { HostedLearningSnapshotClient } from './learning-snapshot-read-repository'
import { readHostedLearningSnapshotWithClient } from './learning-snapshot-read-repository'

const ownerId = '00000000-0000-4000-8000-000000000001'
const decisionAt = '2026-08-08T12:00:00.000Z'
const snapshotRow = {
  owner_id: ownerId,
  decision_at: decisionAt,
  calibration_rows: [],
  category_rows: [],
  evidence_kind_rows: [],
  horizon_rows: [],
  pattern_rows: [],
  assignment_rows: [],
}

function clientFixture(response: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(response)
  return {
    client: { rpc } as unknown as HostedLearningSnapshotClient,
    rpc,
  }
}

afterEach(() => vi.clearAllMocks())

describe('hosted learning snapshot read repository', () => {
  it('uses only the bounded point-in-time RPC and returns serializable rows', async () => {
    const fixture = clientFixture({ data: [snapshotRow], error: null })

    await expect(
      readHostedLearningSnapshotWithClient(fixture.client, ownerId, decisionAt),
    ).resolves.toEqual({
      source: 'supabase',
      decisionAt,
      calibration: [],
      categories: [],
      evidenceKinds: [],
      horizons: [],
      patterns: [],
      assignments: [],
    })
    expect(fixture.rpc).toHaveBeenCalledWith('hosted_learning_snapshot', {
      p_decision_at: decisionAt,
      p_pattern_limit: 100,
    })
  })

  it.each([
    {
      response: {
        data: null,
        error: { message: 'sensitive database detail' },
      },
      operation: 'learning_read',
    },
    {
      response: {
        data: [{ ...snapshotRow, decision_at: '2026-08-08T12:00:01.000Z' }],
        error: null,
      },
      operation: 'learning_validation',
    },
  ])('sanitizes $operation failures', async ({ response, operation }) => {
    const fixture = clientFixture(response)
    await expect(
      readHostedLearningSnapshotWithClient(fixture.client, ownerId, decisionAt),
    ).rejects.toThrow('Hosted learning snapshot read failed')
    expect(logMock).toHaveBeenCalledWith(
      'error',
      'Hosted learning snapshot read failed',
      expect.objectContaining({ operation }),
    )
  })
})
