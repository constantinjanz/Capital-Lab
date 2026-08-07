// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { HostedMarketSnapshot } from './hosted-market-snapshot'

const mocks = vi.hoisted(() => ({
  formAction: vi.fn(),
  useActionState: vi.fn(),
  useFormStatus: vi.fn(),
}))

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  return { ...actual, useActionState: mocks.useActionState }
})
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<typeof import('react-dom')>('react-dom')
  return { ...actual, useFormStatus: mocks.useFormStatus }
})
vi.mock('@/features/markets/actions', () => ({
  configureHostedMarketManifest: vi.fn(),
  runHostedAlpacaIngestion: vi.fn(),
  setHostedAlpacaSourceState: vi.fn(),
}))

import { HostedMarketSetupControl } from './hosted-market-setup-control'
import { HostedMarketsView } from './hosted-markets-view'

const operationId = 'd3000000-0000-4000-8000-000000000001'
const hostedIngestionProps = {
  sourceLifecycleOperationId: 'd3000000-0000-4000-8000-000000000002',
  ingestionOperationId: 'd3000000-0000-4000-8000-000000000003',
  ingestionReadiness: {
    ready: false,
    code: 'provider_disabled' as const,
    message: 'The hosted Alpaca data adapter is not enabled.',
  },
  ingestionWindow: {
    windowStart: '2026-08-06T12:00:00.000Z',
    windowEnd: '2026-08-07T12:00:00.000Z',
  },
}
const emptySnapshot: HostedMarketSnapshot = {
  source: 'supabase',
  decisionAt: '2026-08-07T12:00:00.000Z',
  timeframe: '1m',
  universe: null,
  sources: [],
  instruments: [],
  sessions: [],
}

const configuredInstruments: HostedMarketSnapshot['instruments'] = [
  ['ARCX', 'QQQ', 'Invesco QQQ Trust', 'etf', 'NYSE Arca'],
  ['ARCX', 'SPY', 'SPDR S&P 500 ETF Trust', 'etf', 'NYSE Arca'],
  ['XNAS', 'AAPL', 'Apple Inc.', 'equity', 'Nasdaq Stock Market'],
  ['XNAS', 'MSFT', 'Microsoft Corporation', 'equity', 'Nasdaq Stock Market'],
  ['XNAS', 'NVDA', 'NVIDIA Corporation', 'equity', 'Nasdaq Stock Market'],
].map(([mic, symbol, name, assetClass, exchangeName], index) => ({
  id: `a4000000-0000-4000-8000-00000000000${index + 1}`,
  symbol,
  name,
  assetClass,
  currency: 'USD',
  priceIncrement: '0.010000000000',
  quantityIncrement: '1.000000000000',
  isTradable: true,
  isShortable: false,
  activeFrom: null,
  activeTo: null,
  exchange: {
    id:
      mic === 'ARCX'
        ? 'e4000000-0000-4000-8000-000000000001'
        : 'e4000000-0000-4000-8000-000000000002',
    mic,
    name: exchangeName,
    timezone: 'America/New_York',
  },
  feeds: [],
}))

const configuredSnapshot: HostedMarketSnapshot = {
  ...emptySnapshot,
  universe: {
    id: 'a3000000-0000-4000-8000-000000000001',
    name: 'Capital Lab US Core',
    version: 1,
    description: 'Owner-reviewed paper-only US core market universe.',
    reviewedManifestId: 'capital_lab_us_core_alpaca_iex_v1',
    lockedAt: '2026-08-07T12:00:00.000Z',
    createdAt: '2026-08-07T12:00:00.000Z',
    instrumentIds: configuredInstruments.map((instrument) => instrument.id),
  },
  sources: [
    {
      id: 'b3000000-0000-4000-8000-000000000001',
      code: 'alpaca_iex',
      name: 'Alpaca IEX Market Data',
      provider: 'alpaca',
      sourceType: 'market_data',
      isMock: false,
      isEnabled: false,
      health: null,
    },
  ],
  instruments: configuredInstruments,
}

describe('HostedMarketSetupControl', () => {
  afterEach(() => cleanup())

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useActionState.mockReturnValue([{ status: 'idle' }, mocks.formAction])
    mocks.useFormStatus.mockReturnValue({ pending: false })
  })

  it('renders the fixed disabled data-only boundary and stable operation id', () => {
    render(<HostedMarketSetupControl operationId={operationId} />)

    expect(
      screen.getByRole('button', {
        name: 'Save reviewed market configuration',
      }),
    ).toBeEnabled()
    expect(
      screen.getByText(
        /never change source or policy activation, fetch data, add credentials, or enable ingestion/i,
      ),
    ).toBeVisible()
    expect(document.querySelector('input[name="operationId"]')).toHaveValue(
      operationId,
    )
    expect(document.querySelector('input[name="ownerId"]')).toBeNull()
    expect(document.querySelector('input[name="sourceEnabled"]')).toBeNull()
  })

  it.each([
    [
      { status: 'success', message: 'Reviewed configuration saved.' },
      'status',
      true,
    ],
    [
      { status: 'error', message: 'Configuration rejected safely.' },
      'alert',
      false,
    ],
    [
      { status: 'unknown', message: 'Reload or retry this same setup.' },
      'alert',
      false,
    ],
  ] as const)('renders a safe %s action state', (state, role, disabled) => {
    mocks.useActionState.mockReturnValue([state, mocks.formAction])

    render(<HostedMarketSetupControl operationId={operationId} />)

    expect(screen.getByRole(role)).toHaveTextContent(state.message)
    expect(screen.getByRole('button')).toHaveProperty('disabled', disabled)
  })

  it('keeps setup available for an unrelated universe and hides it only for the reviewed manifest', () => {
    const { rerender } = render(
      <HostedMarketsView
        snapshot={emptySnapshot}
        configurationOperationId={operationId}
        {...hostedIngestionProps}
      />,
    )

    expect(
      screen.getByRole('button', {
        name: 'Save reviewed market configuration',
      }),
    ).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Fetch reviewed IEX batch' }),
    ).toBeNull()

    rerender(
      <HostedMarketsView
        snapshot={{
          ...emptySnapshot,
          universe: {
            id: 'a3000000-0000-4000-8000-000000000001',
            name: 'Capital Lab reviewed market universe',
            version: 1,
            description: null,
            reviewedManifestId: null,
            lockedAt: '2026-08-07T12:00:00.000Z',
            createdAt: '2026-08-07T12:00:00.000Z',
            instrumentIds: [],
          },
        }}
        configurationOperationId={operationId}
        {...hostedIngestionProps}
      />,
    )

    expect(
      screen.getByRole('button', {
        name: 'Save reviewed market configuration',
      }),
    ).toBeVisible()
    expect(
      screen.getByText('Reviewed market manifest not configured'),
    ).toBeVisible()

    rerender(
      <HostedMarketsView
        snapshot={{
          ...configuredSnapshot,
          universe: {
            ...configuredSnapshot.universe!,
            reviewedManifestId: null,
          },
        }}
        configurationOperationId={operationId}
        {...hostedIngestionProps}
      />,
    )

    expect(
      screen.getByRole('button', {
        name: 'Save reviewed market configuration',
      }),
    ).toBeVisible()

    rerender(
      <HostedMarketsView
        snapshot={configuredSnapshot}
        configurationOperationId={operationId}
        {...hostedIngestionProps}
      />,
    )

    expect(
      screen.queryByRole('button', {
        name: 'Save reviewed market configuration',
      }),
    ).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Fetch reviewed IEX batch' }),
    ).toBeVisible()
  })

  it('renders exact deterministic feature values and truthful history coverage', () => {
    const sourceId = configuredSnapshot.sources[0]!.id
    const featureSnapshot: HostedMarketSnapshot = {
      ...configuredSnapshot,
      instruments: configuredSnapshot.instruments.map((instrument, index) =>
        index === 0
          ? {
              ...instrument,
              feeds: [
                {
                  sourceId,
                  quote: null,
                  bar: null,
                  features: {
                    version: 'market-technical-v1',
                    observedBarCount: 21,
                    contiguousBarCount: 21,
                    spreadAbsolute: '1',
                    spreadBps: '90.909090909091',
                    return1m: '0.008403361345',
                    return5m: '0.04347826087',
                    relativeVolume20: '1.095890410959',
                    realizedVolatility5m: '0.019115881796',
                    distanceFromSma5: '0.016949152542',
                    distanceFromTypicalPriceVwap20: '0.083023645199',
                  },
                },
              ],
            }
          : instrument,
      ),
    }

    render(
      <HostedMarketsView
        snapshot={featureSnapshot}
        configurationOperationId={operationId}
        {...hostedIngestionProps}
      />,
    )

    expect(screen.getByText('Technical feature vector')).toBeVisible()
    expect(screen.getByText('90.909090909091')).toBeVisible()
    expect(screen.getByText('0.083023645199')).toBeVisible()
    expect(screen.getByText('21/21')).toBeVisible()
    expect(
      screen.getByText(/missing minute or insufficient exact history/i),
    ).toBeVisible()
  })
})
