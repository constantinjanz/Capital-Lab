'use client'

import { CalendarCheck2, ShieldCheck } from 'lucide-react'
import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'

import { configureHostedOfficialCalendarManifest } from '@/features/markets/actions'
import {
  initialHostedOfficialCalendarConfigurationActionState,
  type HostedOfficialCalendarState,
} from '@/features/markets/hosted-official-calendar'

function ConfigureCalendarButton({ completed }: { completed: boolean }) {
  const { pending } = useFormStatus()

  return (
    <button
      className="button button--primary"
      type="submit"
      disabled={pending || completed}
    >
      <CalendarCheck2 size={15} aria-hidden="true" />
      {pending
        ? 'Saving reviewed calendar...'
        : completed
          ? 'Calendar saved'
          : 'Save reviewed 2026 calendar'}
    </button>
  )
}

export function HostedOfficialCalendarControl({
  operationId,
  state,
}: {
  operationId: string
  state: HostedOfficialCalendarState
}) {
  const [actionState, formAction] = useActionState(
    configureHostedOfficialCalendarManifest,
    initialHostedOfficialCalendarConfigurationActionState,
  )
  const completed =
    state.status === 'configured' || actionState.status === 'success'

  if (state.status === 'configured') {
    return (
      <p className="safe-note">
        <CalendarCheck2 size={14} aria-hidden="true" /> Reviewed 2026 XNAS/ARCX
        calendar attested: {state.sessionCount} weekday records across{' '}
        {state.exchangeCount} exchanges, including{' '}
        {state.earlyCloseSessionCount} early-close and{' '}
        {state.closedSessionCount} holiday records.
      </p>
    )
  }

  if (state.status === 'unavailable') {
    return (
      <p className="safe-note safe-note--warning" role="alert">
        Calendar attestation is temporarily unavailable. Setup is disabled until
        the owner-only database state can be confirmed.
      </p>
    )
  }

  return (
    <form action={formAction} aria-label="Configure official market calendar">
      <input type="hidden" name="operationId" value={operationId} />
      {actionState.message ? (
        <p
          className={completed ? 'form-success' : 'form-error'}
          role={completed ? 'status' : 'alert'}
        >
          {actionState.message}
        </p>
      ) : null}
      <div className="panel-action-row">
        <p className="safe-note">
          <ShieldCheck size={14} aria-hidden="true" /> This stores the fixed
          official 2026 XNAS/ARCX regular-session calendar, including holidays
          and early closes. Both provenance sources remain disabled; no website
          is contacted and no scheduler, provider, AI, or experiment is enabled.
        </p>
        <ConfigureCalendarButton completed={completed} />
      </div>
    </form>
  )
}
