'use client'

import { History, Radar, ShieldCheck } from 'lucide-react'
import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'

import { startHostedDraftExperiment } from './actions'
import {
  initialHostedExperimentStartActionState,
  type HostedExperimentStartMode,
  type HostedExperimentStartReadiness,
} from './start-hosted-draft'

export type HostedExperimentStartOperationIds = Record<
  HostedExperimentStartMode,
  string
>

function StartButton({
  mode,
  blocked,
}: {
  mode: HostedExperimentStartMode
  blocked: boolean
}) {
  const { pending } = useFormStatus()
  const label = mode === 'replay' ? 'Start paper replay' : 'Start paper shadow'

  return (
    <button
      className="button button--primary"
      type="submit"
      disabled={pending || blocked}
    >
      {pending ? 'Locking paper manifest...' : label}
    </button>
  )
}

function StartForm({
  mode,
  experimentId,
  expectedDraftRevision,
  expectedControlStateVersion,
  operationId,
}: {
  mode: HostedExperimentStartMode
  experimentId: string
  expectedDraftRevision: string
  expectedControlStateVersion: string
  operationId: string
}) {
  const [state, formAction] = useActionState(
    startHostedDraftExperiment,
    initialHostedExperimentStartActionState,
  )
  const isReplay = mode === 'replay'
  const confirmation = isReplay ? 'START REPLAY' : 'START SHADOW'
  const fieldId = `hosted-${mode}-confirmation`
  const requiresReload = state.status === 'unknown'
  const confirmationError = state.fieldErrors?.confirmation

  return (
    <form className="lifecycle-control-card" action={formAction}>
      <input type="hidden" name="operationId" value={operationId} />
      <input type="hidden" name="experimentId" value={experimentId} />
      <input
        type="hidden"
        name="expectedDraftRevision"
        value={expectedDraftRevision}
      />
      <input
        type="hidden"
        name="expectedControlStateVersion"
        value={expectedControlStateVersion}
      />
      <input type="hidden" name="mode" value={mode} />
      {isReplay ? (
        <History size={18} aria-hidden="true" />
      ) : (
        <Radar size={18} aria-hidden="true" />
      )}
      <h3>{isReplay ? 'Replay mode' : 'Shadow mode'}</h3>
      <p>
        {isReplay
          ? 'Locks deterministic historical simulation rules. No scheduler or replay cycle is launched by this action.'
          : 'Locks proposal-only rules. The agent and scheduler remain off, so no model call or autonomous cycle begins.'}
      </p>
      <label className="field-label" htmlFor={fieldId}>
        Enter {confirmation}
      </label>
      <input
        id={fieldId}
        name="confirmation"
        required
        autoComplete="off"
        disabled={requiresReload}
        aria-invalid={Boolean(confirmationError)}
        aria-describedby={confirmationError ? `${fieldId}-error` : undefined}
      />
      {confirmationError ? (
        <p className="form-error" id={`${fieldId}-error`}>
          {confirmationError}
        </p>
      ) : null}
      {state.message ? (
        <p className="form-error" role="alert">
          {state.message}
        </p>
      ) : null}
      {requiresReload ? (
        <button
          className="button button--primary"
          type="button"
          onClick={() => window.location.reload()}
        >
          Reload current draft
        </button>
      ) : (
        <StartButton mode={mode} blocked={false} />
      )}
    </form>
  )
}

function BlockedReadiness({
  readiness,
}: {
  readiness: HostedExperimentStartReadiness
}) {
  if (readiness.status === 'unavailable') {
    return (
      <p className="form-error" role="alert">
        Start readiness could not be verified. Reload before taking any action.
      </p>
    )
  }

  const missing: string[] = []
  if (!readiness.draftReady) missing.push('clean disabled draft state')
  if (!readiness.marketManifestId) missing.push('reviewed market manifest')
  if (!readiness.calendarManifestId) missing.push('official 2026 calendar')

  return (
    <p className="safe-note">
      Start is blocked until the database attests{' '}
      {missing.join(', ') || 'all prerequisites'}.
    </p>
  )
}

export function HostedExperimentStartControls({
  readiness,
  operationIds,
}: {
  readiness: HostedExperimentStartReadiness
  operationIds: HostedExperimentStartOperationIds
}) {
  if (readiness.status === 'unavailable' || !readiness.ready) {
    return <BlockedReadiness readiness={readiness} />
  }

  return (
    <div className="lifecycle-controls">
      <div className="safe-note">
        <ShieldCheck size={14} aria-hidden="true" /> Starting locks manifest{' '}
        <span className="mono">{readiness.startManifestId}</span>, creates only
        opening paper-account evidence, and keeps provider runtime fetches,
        scheduler, agent, Sol, web search, orders, and fills off.
      </div>
      <div className="configuration-grid">
        <div className="configuration-item">
          <span>Market</span>
          <strong className="mono">{readiness.marketManifestId}</strong>
          <small>Five-symbol owner-reviewed universe</small>
        </div>
        <div className="configuration-item">
          <span>Calendar</span>
          <strong className="mono">{readiness.calendarManifestId}</strong>
          <small>Fixed XNAS/ARCX 2026 sessions</small>
        </div>
        <div className="configuration-item">
          <span>Risk</span>
          <strong>Long-only / 2.00x max</strong>
          <small>25% single-name / 5% new risk</small>
        </div>
        <div className="configuration-item">
          <span>AI budget policy</span>
          <strong>USD 0.30/day / runtime off</strong>
          <small>USD 10/month / USD 50 lifetime</small>
        </div>
      </div>
      <div className="lifecycle-control-grid">
        <StartForm
          mode="replay"
          experimentId={readiness.experimentId}
          expectedDraftRevision={readiness.draftRevision}
          expectedControlStateVersion={readiness.controlStateVersion}
          operationId={operationIds.replay}
        />
        <StartForm
          mode="shadow"
          experimentId={readiness.experimentId}
          expectedDraftRevision={readiness.draftRevision}
          expectedControlStateVersion={readiness.controlStateVersion}
          operationId={operationIds.shadow}
        />
      </div>
      <p className="muted-copy">
        Expected draft revision{' '}
        <span className="mono">{readiness.draftRevision}</span> and control
        revision <span className="mono">{readiness.controlStateVersion}</span>.
      </p>
    </div>
  )
}
