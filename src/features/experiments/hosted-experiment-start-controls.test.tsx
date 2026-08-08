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
vi.mock('@/features/experiments/actions', () => ({
  startHostedDraftExperiment: mocks.action,
}))

import { HostedExperimentStartControls } from './hosted-experiment-start-controls'

const experimentId = 'e4000000-0000-4000-8000-000000000001'
const replayOperationId = 'd4000000-0000-4000-8000-000000000001'
const shadowOperationId = 'd4000000-0000-4000-8000-000000000002'
const operationIds = {
  replay: replayOperationId,
  shadow: shadowOperationId,
}

function readyState() {
  return {
    status: 'available' as const,
    experimentId,
    decisionAt: '2026-08-08T10:00:00.000Z',
    draftRevision: '9007199254740993',
    controlStateVersion: '9007199254740994',
    draftReady: true,
    startManifestId: 'capital_lab_disabled_runtime_start_v1',
    marketManifestId: 'capital_lab_us_core_alpaca_iex_v1',
    universeId: 'e4000000-0000-4000-8000-000000000002',
    calendarManifestId: 'capital_lab_us_equities_calendar_2026_v1',
    calendarManifestRecordId: 'e4000000-0000-4000-8000-000000000003',
    ready: true,
  }
}

describe('HostedExperimentStartControls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useActionState.mockReturnValue([{ status: 'idle' }, mocks.formAction])
    mocks.useFormStatus.mockReturnValue({ pending: false })
  })
  afterEach(() => cleanup())

  it('renders separate exact replay and shadow owner confirmations', () => {
    render(
      <HostedExperimentStartControls
        readiness={readyState()}
        operationIds={operationIds}
      />,
    )

    expect(
      screen.getByRole('button', { name: 'Start paper replay' }),
    ).toBeEnabled()
    expect(
      screen.getByRole('button', { name: 'Start paper shadow' }),
    ).toBeEnabled()
    expect(screen.getByLabelText('Enter START REPLAY')).toBeRequired()
    expect(screen.getByLabelText('Enter START SHADOW')).toBeRequired()
    expect(
      screen.getByText(
        /scheduler, agent, Sol, web search, orders, and fills off/i,
      ),
    ).toBeVisible()

    const forms = document.querySelectorAll('form')
    expect(forms).toHaveLength(2)
    expect(forms[0]?.querySelector('input[name="operationId"]')).toHaveValue(
      replayOperationId,
    )
    expect(forms[1]?.querySelector('input[name="operationId"]')).toHaveValue(
      shadowOperationId,
    )
    expect(
      forms[0]?.querySelector('input[name="expectedDraftRevision"]'),
    ).toHaveValue('9007199254740993')
    expect(
      forms[1]?.querySelector('input[name="expectedControlStateVersion"]'),
    ).toHaveValue('9007199254740994')
    expect(document.querySelector('input[name="ownerId"]')).toBeNull()
    expect(document.querySelector('input[name="credential"]')).toBeNull()
    expect(document.querySelector('input[name="schedulerEnabled"]')).toBeNull()
  })

  it('renders no mutation controls when readiness is unavailable', () => {
    render(
      <HostedExperimentStartControls
        readiness={{ status: 'unavailable' }}
        operationIds={operationIds}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      /readiness could not be verified/i,
    )
    expect(screen.queryByRole('button')).toBeNull()
    expect(mocks.useActionState).not.toHaveBeenCalled()
  })

  it('names missing reviewed prerequisites without rendering a start button', () => {
    render(
      <HostedExperimentStartControls
        readiness={{
          ...readyState(),
          draftReady: false,
          marketManifestId: null,
          universeId: null,
          calendarManifestId: null,
          calendarManifestRecordId: null,
          ready: false,
        }}
        operationIds={operationIds}
      />,
    )

    expect(screen.getByText(/clean disabled draft state/i)).toBeVisible()
    expect(screen.getByText(/reviewed market manifest/i)).toBeVisible()
    expect(screen.getByText(/official 2026 calendar/i)).toBeVisible()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('isolates an unknown outcome to the submitted mode and requires reload', () => {
    mocks.useActionState
      .mockReturnValueOnce([
        {
          status: 'unknown',
          message: 'The start result could not be confirmed.',
        },
        mocks.formAction,
      ])
      .mockReturnValueOnce([{ status: 'idle' }, mocks.formAction])

    render(
      <HostedExperimentStartControls
        readiness={readyState()}
        operationIds={operationIds}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The start result could not be confirmed.',
    )
    expect(
      screen.getByRole('button', { name: 'Reload current draft' }),
    ).toBeEnabled()
    expect(
      screen.queryByRole('button', { name: 'Start paper replay' }),
    ).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Start paper shadow' }),
    ).toBeEnabled()
  })
})
