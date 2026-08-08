// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  action: vi.fn(),
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
  configureHostedOfficialCalendarManifest: mocks.action,
}))

import { HostedOfficialCalendarControl } from './hosted-official-calendar-control'

const operationId = 'd3000000-0000-4000-8000-000000000001'

describe('HostedOfficialCalendarControl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useActionState.mockReturnValue([{ status: 'idle' }, mocks.formAction])
    mocks.useFormStatus.mockReturnValue({ pending: false })
  })
  afterEach(() => cleanup())

  it('renders the fixed no-runtime-request setup boundary', () => {
    render(
      <HostedOfficialCalendarControl
        operationId={operationId}
        state={{
          status: 'unconfigured',
          decisionAt: '2026-08-08T10:00:00.000Z',
          calendarYear: 2026,
        }}
      />,
    )

    expect(
      screen.getByRole('button', { name: 'Save reviewed 2026 calendar' }),
    ).toBeEnabled()
    expect(
      screen.getByText(/no scheduler, provider, AI, or experiment is enabled/i),
    ).toBeVisible()
    expect(document.querySelector('input[name="operationId"]')).toHaveValue(
      operationId,
    )
    expect(document.querySelector('input[name="ownerId"]')).toBeNull()
    expect(document.querySelector('input[name="sourceUrl"]')).toBeNull()
  })

  it('renders exact attested counts without a mutation control', () => {
    render(
      <HostedOfficialCalendarControl
        operationId={operationId}
        state={{
          status: 'configured',
          decisionAt: '2026-08-08T10:00:00.000Z',
          manifestId: 'capital_lab_us_equities_calendar_2026_v1',
          manifestRecordId: 'e3000000-0000-4000-8000-000000000001',
          calendarYear: 2026,
          exchangeCount: 2,
          sessionCount: 522,
          regularSessionCount: 498,
          earlyCloseSessionCount: 4,
          closedSessionCount: 20,
        }}
      />,
    )

    expect(
      screen.getByText(/522 weekday records across 2 exchanges/i),
    ).toBeVisible()
    expect(
      screen.getByText(/4 early-close and 20 holiday records/i),
    ).toBeVisible()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('disables setup when database attestation is unavailable', () => {
    render(
      <HostedOfficialCalendarControl
        operationId={operationId}
        state={{ status: 'unavailable', calendarYear: 2026 }}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      /setup is disabled until the owner-only database state can be confirmed/i,
    )
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('surfaces a retry-safe action result and disables a completed operation', () => {
    mocks.useActionState.mockReturnValue([
      { status: 'success', message: 'Reviewed calendar saved.' },
      mocks.formAction,
    ])

    render(
      <HostedOfficialCalendarControl
        operationId={operationId}
        state={{
          status: 'unconfigured',
          decisionAt: '2026-08-08T10:00:00.000Z',
          calendarYear: 2026,
        }}
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent(
      'Reviewed calendar saved.',
    )
    expect(
      screen.getByRole('button', { name: 'Calendar saved' }),
    ).toBeDisabled()
  })
})
