import { describe, expect, it } from 'vitest'

import {
  deriveHostedMarketIngestionReadiness,
  parseHostedMarketIngestionForm,
  parseHostedSourceLifecycleForm,
} from './hosted-market-ingestion'

const operationId = 'd4000000-0000-4000-8000-000000000001'

function environment() {
  return {
    MARKET_DATA_PROVIDER: 'alpaca' as const,
    ALPACA_DATA_FEED: 'iex' as const,
    ALPACA_API_KEY_ID: 'configured',
    ALPACA_API_SECRET_KEY: 'configured',
    SCHEDULER_PROVIDER: 'manual' as const,
    AGENT_ENABLED: false,
  }
}

describe('hosted market ingestion contract', () => {
  it('accepts only a bounded reusable operation window', () => {
    const form = new FormData()
    form.set('operationId', operationId)
    form.set('windowStart', '2026-08-07T12:00:00.000Z')
    form.set('windowEnd', '2026-08-07T13:00:00.000Z')

    expect(parseHostedMarketIngestionForm(form)).toEqual({
      success: true,
      data: {
        operationId,
        windowStart: '2026-08-07T12:00:00.000Z',
        windowEnd: '2026-08-07T13:00:00.000Z',
      },
    })

    form.set('windowEnd', '2026-08-08T13:00:00.001Z')
    expect(parseHostedMarketIngestionForm(form)).toMatchObject({
      success: false,
    })
  })

  it('ignores lifecycle fields other than operation and target state', () => {
    const form = new FormData()
    form.set('operationId', operationId)
    form.set('enabled', 'true')
    form.set('sourceId', 'forged')
    form.set('provider', 'broker')
    form.set('apiKey', 'ignored')

    expect(parseHostedSourceLifecycleForm(form)).toEqual({
      success: true,
      data: { operationId, enabled: true },
    })
  })

  it.each([
    [{ AGENT_ENABLED: true }, 'agent_enabled'],
    [{ SCHEDULER_PROVIDER: 'vercel' as const }, 'scheduler_not_manual'],
    [{ MARKET_DATA_PROVIDER: 'mock' as const }, 'provider_disabled'],
    [{ ALPACA_DATA_FEED: 'sip' as const }, 'feed_not_reviewed'],
    [{ ALPACA_API_SECRET_KEY: undefined }, 'credentials_missing'],
  ])('fails closed for unsafe environment %o', (override, code) => {
    expect(
      deriveHostedMarketIngestionReadiness({
        ...environment(),
        ...override,
      }),
    ).toMatchObject({ ready: false, code })
  })

  it('reports readiness without exposing credential values', () => {
    const result = deriveHostedMarketIngestionReadiness(environment())
    expect(result).toMatchObject({ ready: true, code: 'ready' })
    expect(JSON.stringify(result)).not.toContain('configured')
  })
})
