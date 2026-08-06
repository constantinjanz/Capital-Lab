import { describe, expect, it } from 'vitest'

import type { SourceEvent } from './types'

import { deduplicateEvents, eventFeaturesAsOf } from './deduplication'

function event(overrides: Partial<SourceEvent> = {}): SourceEvent {
  return {
    externalId: 'release-1',
    canonicalUrl: 'https://www.federalreserve.gov/release-1',
    sourceType: 'federal_reserve',
    issuingAuthority: 'Federal Reserve',
    title: 'Policy release',
    sanitizedText: 'Evidence only.',
    contentHash: 'hash-1',
    language: 'en',
    publishedAt: '2026-08-06T14:00:00.000Z',
    firstSeenAt: '2026-08-06T14:01:00.000Z',
    availableAt: '2026-08-06T14:01:00.000Z',
    sourceQuality: 'primary',
    licensing: 'public official source',
    retentionPolicy: 'metadata and content hash',
    synthetic: true,
    ...overrides,
  }
}

describe('event ingestion rules', () => {
  it('deduplicates exact delivery while retaining a real immutable revision', () => {
    const original = event()
    const duplicate = event({ firstSeenAt: '2026-08-06T14:02:00.000Z' })
    const revision = event({
      contentHash: 'hash-2',
      publishedAt: '2026-08-06T14:03:00.000Z',
      availableAt: '2026-08-06T14:04:00.000Z',
      revisionOf: 'release-1',
    })
    const result = deduplicateEvents([revision, duplicate, original])
    expect(result.accepted.map((item) => item.contentHash)).toEqual([
      'hash-1',
      'hash-2',
    ])
    expect(result.duplicates).toEqual([
      { externalId: 'release-1', reason: 'content_hash' },
    ])
  })

  it('computes features only from evidence available at decision time', () => {
    const features = eventFeaturesAsOf(
      [
        event(),
        event({
          externalId: 'future',
          contentHash: 'future-hash',
          availableAt: '2026-08-06T15:00:00.000Z',
        }),
      ],
      '2026-08-06T14:30:00.000Z',
    )
    expect(features).toMatchObject({ total: 1, primarySources: 1 })
  })
})
