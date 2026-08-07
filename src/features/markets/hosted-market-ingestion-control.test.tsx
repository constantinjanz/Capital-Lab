// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  runHostedAlpacaIngestion: vi.fn(),
  setHostedAlpacaSourceState: vi.fn(),
}))

import { HostedMarketIngestionControl } from './hosted-market-ingestion-control'

const lifecycleOperationId = 'd3000000-0000-4000-8000-000000000001'
const ingestionOperationId = 'd3000000-0000-4000-8000-000000000002'
const windowStart = '2026-08-06T12:00:00.000Z'
const windowEnd = '2026-08-07T12:00:00.000Z'
const ready = {
  ready: true,
  code: 'ready' as const,
  message: 'Ready for one owner-triggered Alpaca IEX batch.',
}

describe('HostedMarketIngestionControl', () => {
  afterEach(() => cleanup())

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useActionState.mockReturnValue([{ status: 'idle' }, mocks.formAction])
    mocks.useFormStatus.mockReturnValue({ pending: false })
  })

  it('keeps ingestion disabled until the reviewed source is explicitly enabled', () => {
    const { rerender } = render(
      <HostedMarketIngestionControl
        lifecycleOperationId={lifecycleOperationId}
        ingestionOperationId={ingestionOperationId}
        readiness={ready}
        sourceEnabled={false}
        windowStart={windowStart}
        windowEnd={windowEnd}
      />,
    )

    expect(
      screen.getByRole('button', { name: 'Enable Alpaca IEX source' }),
    ).toBeEnabled()
    expect(
      screen.getByRole('button', { name: 'Fetch reviewed IEX batch' }),
    ).toBeDisabled()

    rerender(
      <HostedMarketIngestionControl
        lifecycleOperationId={lifecycleOperationId}
        ingestionOperationId={ingestionOperationId}
        readiness={ready}
        sourceEnabled
        windowStart={windowStart}
        windowEnd={windowEnd}
      />,
    )

    expect(
      screen.getByRole('button', { name: 'Disable Alpaca IEX source' }),
    ).toBeEnabled()
    expect(
      screen.getByRole('button', { name: 'Fetch reviewed IEX batch' }),
    ).toBeEnabled()
  })

  it('posts separate stable operations and the bounded completed-minute window', () => {
    render(
      <HostedMarketIngestionControl
        lifecycleOperationId={lifecycleOperationId}
        ingestionOperationId={ingestionOperationId}
        readiness={ready}
        sourceEnabled
        windowStart={windowStart}
        windowEnd={windowEnd}
      />,
    )

    const lifecycleForm = screen.getByRole('form', {
      name: 'Set Alpaca IEX source state',
    })
    expect(
      within(lifecycleForm).getByDisplayValue(lifecycleOperationId),
    ).toHaveAttribute('name', 'operationId')
    expect(within(lifecycleForm).getByDisplayValue('false')).toHaveAttribute(
      'name',
      'enabled',
    )

    const ingestionForm = screen.getByRole('form', {
      name: 'Run Alpaca IEX ingestion',
    })
    expect(
      within(ingestionForm).getByDisplayValue(ingestionOperationId),
    ).toHaveAttribute('name', 'operationId')
    expect(
      within(ingestionForm).getByDisplayValue(windowStart),
    ).toHaveAttribute('name', 'windowStart')
    expect(within(ingestionForm).getByDisplayValue(windowEnd)).toHaveAttribute(
      'name',
      'windowEnd',
    )
  })

  it('communicates the complete data-only boundary without credential values', () => {
    render(
      <HostedMarketIngestionControl
        lifecycleOperationId={lifecycleOperationId}
        ingestionOperationId={ingestionOperationId}
        readiness={{
          ready: false,
          code: 'credentials_missing',
          message: 'Server-side Market Data credentials are not configured.',
        }}
        sourceEnabled
        windowStart={windowStart}
        windowEnd={windowEnd}
      />,
    )

    expect(screen.getByText(/SPY, QQQ, AAPL, MSFT, NVDA/)).toBeVisible()
    expect(
      screen.getByText(/latest quotes and completed raw 1m bars/i),
    ).toBeVisible()
    expect(
      screen.getByText(/No scheduler, AI, orders, or exchange-calendar data/i),
    ).toBeVisible()
    expect(screen.getByText(/No credential values are sent/i)).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Fetch reviewed IEX batch' }),
    ).toBeDisabled()
  })
})
