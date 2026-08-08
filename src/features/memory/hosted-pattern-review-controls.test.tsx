// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
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
vi.mock('@/features/memory/actions', () => ({
  reviewHostedPatternLifecycle: vi.fn(),
}))

import { HostedPatternReviewControls } from './hosted-pattern-review-controls'

const patternId = '20000000-0000-4000-8000-000000000001'
const operationIds = {
  start_shadow: '10000000-0000-4000-8000-000000000001',
  mark_eligible: '10000000-0000-4000-8000-000000000002',
  reject: '10000000-0000-4000-8000-000000000003',
  retire: '10000000-0000-4000-8000-000000000004',
}

describe('HostedPatternReviewControls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useActionState.mockReturnValue([{ status: 'idle' }, mocks.formAction])
    mocks.useFormStatus.mockReturnValue({ pending: false })
  })
  afterEach(() => cleanup())

  it('shows only transitions available from shadow with exact confirmations', () => {
    render(
      <HostedPatternReviewControls
        patternId={patternId}
        patternName="Measured pattern"
        expectedStatus="shadow"
        operationIds={operationIds}
      />,
    )

    expect(screen.getByRole('button', { name: 'Mark eligible' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Reject pattern' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Retire pattern' })).toBeEnabled()
    expect(
      screen.queryByRole('button', { name: 'Start shadow review' }),
    ).not.toBeInTheDocument()
    expect(screen.getByLabelText('Enter MARK PATTERN ELIGIBLE')).toBeRequired()
    expect(screen.getAllByLabelText('Owner reason')).toHaveLength(2)
    expect(
      screen.getByText(/Agents, assignments, allocations, orders, and fills/i),
    ).toBeVisible()
  })

  it('renders terminal lifecycle state without a mutation form', () => {
    render(
      <HostedPatternReviewControls
        patternId={patternId}
        patternName="Retired pattern"
        expectedStatus="retired"
        operationIds={operationIds}
      />,
    )

    expect(screen.getByText(/terminal/i)).toBeVisible()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('blocks stale actions after an unconfirmed result', () => {
    mocks.useActionState.mockReturnValue([
      { status: 'unknown', message: 'Reload Memory.' },
      mocks.formAction,
    ])

    render(
      <HostedPatternReviewControls
        patternId={patternId}
        patternName="Measured pattern"
        expectedStatus="shadow"
        operationIds={operationIds}
      />,
    )

    expect(screen.getByRole('button', { name: 'Refresh Memory' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Mark eligible' })).toBeDisabled()
  })
})
