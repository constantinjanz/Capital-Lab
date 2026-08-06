import type { MarketQuote, PointInTimeRecord } from './types'

function timestamp(value: string): number {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) {
    throw new TypeError(`Invalid timestamp: ${value}`)
  }
  return parsed
}

export function isVisibleAt(record: PointInTimeRecord, asOf: string): boolean {
  const cutoff = timestamp(asOf)
  const firstSeen = timestamp(record.firstSeenAt)
  const available = timestamp(record.availableAt)
  return firstSeen <= available && available <= cutoff
}

export function latestVisibleRevisions<T extends PointInTimeRecord>(
  records: readonly T[],
  asOf: string,
): T[] {
  const selected = new Map<string, T>()
  for (const record of records) {
    if (!isVisibleAt(record, asOf)) continue
    const current = selected.get(record.logicalId)
    if (
      current === undefined ||
      timestamp(record.availableAt) > timestamp(current.availableAt) ||
      (record.availableAt === current.availableAt &&
        record.revision > current.revision)
    ) {
      selected.set(record.logicalId, record)
    }
  }
  return [...selected.values()]
}

export function selectFirstExecutableQuote(input: {
  quotes: readonly MarketQuote[]
  instrumentId: string
  eligibleAt: string
  simulationAsOf: string
  staleAfterMs: number
}): MarketQuote | undefined {
  if (!Number.isInteger(input.staleAfterMs) || input.staleAfterMs < 0) {
    throw new RangeError('staleAfterMs must be a non-negative integer')
  }
  const eligibleAt = timestamp(input.eligibleAt)
  const asOf = timestamp(input.simulationAsOf)

  return latestVisibleRevisions(input.quotes, input.simulationAsOf)
    .filter((quote) => {
      const eventAt = timestamp(quote.providerEventAt)
      const opportunityAt = timestamp(quote.availableAt)
      return (
        quote.instrumentId === input.instrumentId &&
        eventAt >= eligibleAt &&
        opportunityAt <= asOf &&
        opportunityAt - eventAt <= input.staleAfterMs
      )
    })
    .sort((left, right) => {
      const byOpportunity =
        timestamp(left.availableAt) - timestamp(right.availableAt)
      return byOpportunity !== 0
        ? byOpportunity
        : left.id.localeCompare(right.id)
    })[0]
}
