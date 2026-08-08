import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  hostedView: vi.fn(),
  memoryView: vi.fn(),
  readLearning: vi.fn(),
  readMemory: vi.fn(),
  requireOwner: vi.fn(),
}))

vi.mock('@/features/memory/hosted-memory-view', () => ({
  HostedMemoryView: mocks.hostedView,
}))
vi.mock('@/features/memory/memory-view', () => ({
  MemoryView: mocks.memoryView,
}))
vi.mock('@/lib/auth/require-owner', () => ({
  requireOwner: mocks.requireOwner,
}))
vi.mock('@/lib/mock/repository', () => ({
  mockRepository: { getMemory: vi.fn(() => ({ mode: 'mock' })) },
}))
vi.mock('@/lib/supabase/decision-memory-read-repository', () => ({
  decisionAtForHostedMemoryRead: () => '2026-08-08T12:00:00.000Z',
  readHostedDecisionMemory: mocks.readMemory,
}))
vi.mock('@/lib/supabase/learning-snapshot-read-repository', () => ({
  readHostedLearningSnapshot: mocks.readLearning,
}))

import MemoryPage from './page'

const ownerId = '00000000-0000-4000-8000-000000000001'
const patternId = '20000000-0000-4000-8000-000000000001'
const decisionAt = '2026-08-08T12:00:00.000Z'

describe('MemoryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireOwner.mockResolvedValue({ mode: 'supabase', id: ownerId })
    mocks.readMemory.mockResolvedValue({ source: 'supabase', decisionAt })
    mocks.readLearning.mockResolvedValue({
      source: 'supabase',
      decisionAt,
      patterns: [{ id: patternId, lifecycleStatus: 'shadow' }],
    })
  })

  it('uses one historical timestamp for both hosted reads and creates only operation ids for the client', async () => {
    const element = await MemoryPage()

    expect(mocks.readMemory).toHaveBeenCalledWith(ownerId, decisionAt)
    expect(mocks.readLearning).toHaveBeenCalledWith(ownerId, decisionAt)
    expect(element.type).toBe(mocks.hostedView)
    expect(element.props).toMatchObject({
      decisionAt,
      memory: { source: 'supabase', decisionAt },
      learning: { source: 'supabase', decisionAt },
      patternReviewOperationIds: {
        [patternId]: {
          mark_eligible: expect.stringMatching(/^[0-9a-f-]{36}$/),
          reject: expect.stringMatching(/^[0-9a-f-]{36}$/),
          retire: expect.stringMatching(/^[0-9a-f-]{36}$/),
        },
      },
    })
  })

  it('keeps an independently failed learning read unavailable without substituting mock data', async () => {
    mocks.readLearning.mockRejectedValue(new Error('sanitized failure'))

    const element = await MemoryPage()
    expect(element.props.learning).toBeNull()
    expect(element.props.patternReviewOperationIds).toEqual({})
  })

  it('preserves the local mock view without any hosted read', async () => {
    mocks.requireOwner.mockResolvedValue({ mode: 'mock', id: 'mock-owner' })

    const element = await MemoryPage()
    expect(element.type).toBe(mocks.memoryView)
    expect(mocks.readMemory).not.toHaveBeenCalled()
    expect(mocks.readLearning).not.toHaveBeenCalled()
  })
})
