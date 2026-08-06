import type { EventProvider, SourceEvent } from './types'

export type ApprovedSocialProviderConfiguration = {
  enabled: boolean
  verifiedAccountIds: readonly string[]
  topicalFilters: readonly string[]
}

/** Disabled-by-default port. No scraping implementation is provided. */
export class DisabledSocialEventProvider implements EventProvider {
  readonly name = 'disabled-approved-social-provider'
  readonly mode = 'mock' as const

  async fetchSince(since: string, observedAt: string): Promise<SourceEvent[]> {
    void since
    void observedAt
    return []
  }
}
