import { describe, expect, it } from 'vitest'

import { chunkResearchDocument, pointInTimeChunks } from './research'

describe('research import and point-in-time retrieval', () => {
  it('chunks deterministically and labels synthetic evidence', () => {
    const first = chunkResearchDocument({
      sourceId: 'fixture',
      title: 'Synthetic microstructure note',
      content: 'First paragraph.\n\nSecond paragraph.',
      availableAt: '2026-08-06T10:00:00.000Z',
      sourceQuality: 'synthetic',
      tags: ['fixture'],
    })
    const second = chunkResearchDocument({
      sourceId: 'fixture',
      title: 'Synthetic microstructure note',
      content: 'First paragraph.\n\nSecond paragraph.',
      availableAt: '2026-08-06T10:00:00.000Z',
      sourceQuality: 'synthetic',
      tags: ['fixture'],
    })
    expect(first).toEqual(second)
    expect(first.warnings).toHaveLength(1)
  })

  it('rejects future document versions from historical context', () => {
    const preview = chunkResearchDocument({
      sourceId: 'future',
      title: 'Future correction',
      content: 'Not available yet.',
      availableAt: '2026-08-06T15:00:00.000Z',
      sourceQuality: 'primary',
      tags: [],
    })
    expect(
      pointInTimeChunks(preview.chunks, '2026-08-06T14:59:59.999Z'),
    ).toEqual([])
  })
})
