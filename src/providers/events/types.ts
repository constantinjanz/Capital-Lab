import type { SourceEvent } from '@/domain/events/types'

export { sourceEventSchema } from '@/domain/events/types'
export type { SourceEvent } from '@/domain/events/types'

export interface EventProvider {
  readonly name: string
  readonly mode: 'mock' | 'live'
  fetchSince(since: string, observedAt: string): Promise<SourceEvent[]>
}
