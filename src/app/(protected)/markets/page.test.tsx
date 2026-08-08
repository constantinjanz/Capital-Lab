import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { HostedMarketIngestionReadiness } from '@/features/markets/hosted-market-ingestion'

const mocks = vi.hoisted(() => ({
  getEnvironment: vi.fn(),
  readCalendarState: vi.fn(),
  readSnapshot: vi.fn(),
  requireOwner: vi.fn(),
}))

vi.mock('@/lib/auth/require-owner', () => ({
  requireOwner: mocks.requireOwner,
}))
vi.mock('@/lib/env/server', () => ({
  getServerEnvironment: mocks.getEnvironment,
}))
vi.mock('@/lib/supabase/market-snapshot-read-repository', () => ({
  readHostedMarketSnapshot: mocks.readSnapshot,
}))
vi.mock('@/lib/supabase/official-calendar-read-repository', () => ({
  readHostedOfficialCalendarState: mocks.readCalendarState,
}))
vi.mock('@/features/markets/hosted-markets-view', () => ({
  HostedMarketsView: vi.fn(),
}))
vi.mock('@/features/markets/markets-view', () => ({ MarketsView: vi.fn() }))
vi.mock('@/lib/mock/repository', () => ({
  mockRepository: { getMarkets: vi.fn() },
}))

import MarketsPage from './page'

type HostedMarketsViewProps = {
  ingestionReadiness: HostedMarketIngestionReadiness
}

describe('hosted Markets page ingestion readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireOwner.mockResolvedValue({
      mode: 'supabase',
      id: '00000000-0000-4000-8000-000000000001',
    })
    mocks.readSnapshot.mockResolvedValue({})
    mocks.readCalendarState.mockResolvedValue({
      status: 'unconfigured',
      decisionAt: '2026-08-07T12:00:00.000Z',
      calendarYear: 2026,
    })
  })

  it('keeps source deactivation reachable when environment parsing fails', async () => {
    mocks.getEnvironment.mockImplementation(() => {
      throw new Error('raw environment validation detail')
    })

    const page = (await MarketsPage()) as ReactElement<HostedMarketsViewProps>

    expect(page.props.ingestionReadiness).toEqual({
      ready: false,
      code: 'environment_invalid',
      message:
        'The server-side market data environment is invalid. Source deactivation remains available.',
    })
    expect(JSON.stringify(page.props)).not.toContain(
      'raw environment validation detail',
    )
  })

  it('renders a credential-missing state for staged Alpaca mode', async () => {
    mocks.getEnvironment.mockReturnValue({
      MARKET_DATA_PROVIDER: 'alpaca',
      ALPACA_DATA_FEED: 'iex',
      SCHEDULER_PROVIDER: 'manual',
      AGENT_ENABLED: false,
    })

    const page = (await MarketsPage()) as ReactElement<HostedMarketsViewProps>

    expect(page.props.ingestionReadiness).toMatchObject({
      ready: false,
      code: 'credentials_missing',
    })
  })
})
