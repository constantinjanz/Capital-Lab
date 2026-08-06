import 'server-only'

import { createHash } from 'node:crypto'

import {
  sanitizeExternalContent,
  type ExternalContent,
} from '@/lib/security/external-content'

import type { EventProvider, SourceEvent } from './types'

export type OfficialSourceDefinition = {
  name: string
  origin: string
  sourceType: SourceEvent['sourceType']
  issuingAuthority: string
  userAgent: string
  licensing: string
  retentionPolicy: string
  minimumIntervalMs: number
  parse: (body: string, observedAt: string) => ExternalContent[]
}

/** Allowlisted one-origin connector; it cannot crawl discovered links. */
export class OfficialHttpEventProvider implements EventProvider {
  readonly mode = 'live' as const
  readonly name: string
  private lastRequestAt = 0

  constructor(
    private readonly definition: OfficialSourceDefinition,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    const url = new URL(definition.origin)
    if (url.protocol !== 'https:')
      throw new Error('Official sources require HTTPS')
    this.name = definition.name
  }

  async fetchSince(_since: string, observedAt: string): Promise<SourceEvent[]> {
    const now = Date.now()
    if (now - this.lastRequestAt < this.definition.minimumIntervalMs) return []
    this.lastRequestAt = now
    const url = new URL(this.definition.origin)
    const response = await this.fetcher(url, {
      headers: {
        Accept:
          'application/json, application/rss+xml, application/xml, text/xml',
        'User-Agent': this.definition.userAgent,
      },
      redirect: 'error',
      cache: 'no-store',
    })
    if (!response.ok)
      throw new Error(`${this.name} returned ${response.status}`)
    return this.definition
      .parse(await response.text(), observedAt)
      .map((item) => {
        const content = sanitizeExternalContent(item)
        const hash = createHash('sha256')
          .update(`${content.title}\n${content.text}`)
          .digest('hex')
        return {
          externalId: content.sourceId,
          canonicalUrl: content.canonicalUrl,
          sourceType: this.definition.sourceType,
          issuingAuthority: this.definition.issuingAuthority,
          title: content.title,
          sanitizedText: content.text,
          contentHash: hash,
          language: 'en',
          publishedAt: observedAt,
          firstSeenAt: observedAt,
          availableAt: observedAt,
          sourceQuality: 'primary',
          licensing: this.definition.licensing,
          retentionPolicy: this.definition.retentionPolicy,
          synthetic: false,
        }
      })
  }
}
