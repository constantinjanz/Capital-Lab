import type { SourceEvent } from './types'

export type EventDeduplicationResult = {
  accepted: SourceEvent[]
  duplicates: Array<{
    externalId: string
    reason: 'content_hash' | 'source_revision'
  }>
}

/**
 * Keeps immutable source revisions while rejecting exact content re-delivery.
 * Ordering is deterministic so retries produce the same result.
 */
export function deduplicateEvents(
  events: readonly SourceEvent[],
): EventDeduplicationResult {
  const accepted: SourceEvent[] = []
  const duplicates: EventDeduplicationResult['duplicates'] = []
  const hashes = new Set<string>()
  const sourceRevisions = new Set<string>()

  for (const event of [...events].sort((left, right) => {
    const byAvailability = left.availableAt.localeCompare(right.availableAt)
    if (byAvailability !== 0) return byAvailability
    return left.externalId.localeCompare(right.externalId)
  })) {
    const revisionKey = [
      event.sourceType,
      event.externalId,
      event.publishedAt,
    ].join(':')
    if (hashes.has(event.contentHash)) {
      duplicates.push({ externalId: event.externalId, reason: 'content_hash' })
      continue
    }
    if (sourceRevisions.has(revisionKey)) {
      duplicates.push({
        externalId: event.externalId,
        reason: 'source_revision',
      })
      continue
    }
    hashes.add(event.contentHash)
    sourceRevisions.add(revisionKey)
    accepted.push(event)
  }
  return { accepted, duplicates }
}

export type EventFeatureVector = {
  total: number
  primarySources: number
  licensedSources: number
  distinctAuthorities: number
  latestAvailableAt?: string
}

export function eventFeaturesAsOf(
  events: readonly SourceEvent[],
  decisionAt: string,
): EventFeatureVector {
  const cutoff = Date.parse(decisionAt)
  if (!Number.isFinite(cutoff))
    throw new TypeError('Invalid decision timestamp')
  const visible = events.filter(
    (event) => Date.parse(event.availableAt) <= cutoff,
  )
  return {
    total: visible.length,
    primarySources: visible.filter((event) => event.sourceQuality === 'primary')
      .length,
    licensedSources: visible.filter(
      (event) => event.sourceQuality === 'licensed',
    ).length,
    distinctAuthorities: new Set(visible.map((event) => event.issuingAuthority))
      .size,
    latestAvailableAt: visible
      .map((event) => event.availableAt)
      .sort()
      .at(-1),
  }
}
