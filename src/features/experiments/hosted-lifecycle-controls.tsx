'use client'

import {
  CheckCircle2,
  CirclePause,
  Copy,
  Play,
  ShieldCheck,
} from 'lucide-react'
import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'

import { mutateHostedLockedExperimentLifecycle } from './actions'
import type { HostedLifecycleAction } from './mutate-hosted-lifecycle'
import { initialHostedLifecycleActionState } from './mutate-hosted-lifecycle'

export type HostedLifecycleOperationIds = Record<HostedLifecycleAction, string>

export type HostedLifecycleAvailability = Record<HostedLifecycleAction, boolean>

function SubmitLifecycleButton({
  label,
  pendingLabel,
  danger = false,
  blocked,
}: {
  label: string
  pendingLabel: string
  danger?: boolean
  blocked: boolean
}) {
  const { pending } = useFormStatus()

  return (
    <button
      className={`button ${danger ? 'button--danger' : 'button--secondary'}`}
      type="submit"
      disabled={pending || blocked}
    >
      {pending ? pendingLabel : label}
    </button>
  )
}

function CommonFields({
  action,
  experimentId,
  expectedControlStateVersion,
  operationId,
}: {
  action: HostedLifecycleAction
  experimentId: string
  expectedControlStateVersion: string
  operationId: string
}) {
  return (
    <>
      <input type="hidden" name="action" value={action} />
      <input type="hidden" name="experimentId" value={experimentId} />
      <input
        type="hidden"
        name="expectedControlStateVersion"
        value={expectedControlStateVersion}
      />
      <input type="hidden" name="operationId" value={operationId} />
    </>
  )
}

export function HostedLifecycleControls({
  experimentId,
  experimentName,
  expectedControlStateVersion,
  lockedVersionId,
  availability,
  operationIds,
}: {
  experimentId: string
  experimentName: string
  expectedControlStateVersion: string
  lockedVersionId: string
  availability: HostedLifecycleAvailability
  operationIds: HostedLifecycleOperationIds
}) {
  const [state, formAction] = useActionState(
    mutateHostedLockedExperimentLifecycle,
    initialHostedLifecycleActionState,
  )
  const requiresReload = state.status === 'unknown'
  const defaultCloneName = `${experimentName.slice(0, 95).trimEnd()} copy`

  return (
    <div className="lifecycle-controls">
      <div className="safe-note">
        <ShieldCheck size={14} aria-hidden="true" /> These actions affect only
        the locked paper simulator. Scheduler and agent controls remain off.
      </div>
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
          Reload current experiment
        </button>
      ) : null}
      <div className="lifecycle-control-grid">
        {availability.promote_live_paper ? (
          <form className="lifecycle-control-card" action={formAction}>
            <CommonFields
              action="promote_live_paper"
              experimentId={experimentId}
              expectedControlStateVersion={expectedControlStateVersion}
              operationId={operationIds.promote_live_paper}
            />
            <input
              type="hidden"
              name="lockedVersionId"
              value={lockedVersionId}
            />
            <Play size={18} aria-hidden="true" />
            <h3>Promote to live paper</h3>
            <p>
              Changes the locked shadow label to live-paper simulation. It
              cannot reach a broker or enable an execution schedule.
            </p>
            <label className="field-label" htmlFor="live-paper-confirmation">
              Enter PROMOTE TO LIVE PAPER
            </label>
            <input
              id="live-paper-confirmation"
              name="confirmation"
              required
              autoComplete="off"
              disabled={requiresReload}
              aria-invalid={Boolean(state.fieldErrors?.confirmation)}
              aria-describedby={
                state.fieldErrors?.confirmation
                  ? 'live-paper-confirmation-error'
                  : undefined
              }
            />
            {state.fieldErrors?.confirmation ? (
              <p className="form-error" id="live-paper-confirmation-error">
                {state.fieldErrors.confirmation}
              </p>
            ) : null}
            <SubmitLifecycleButton
              label="Promote paper simulator"
              pendingLabel="Promoting..."
              blocked={requiresReload}
            />
          </form>
        ) : null}

        {availability.pause ? (
          <form className="lifecycle-control-card" action={formAction}>
            <CommonFields
              action="pause"
              experimentId={experimentId}
              expectedControlStateVersion={expectedControlStateVersion}
              operationId={operationIds.pause}
            />
            <CirclePause size={18} aria-hidden="true" />
            <h3>Pause experiment</h3>
            <p>
              Stops further simulated lifecycle work and keeps market-data reads
              available for review.
            </p>
            <label className="field-label" htmlFor="lifecycle-pause-reason">
              Owner reason
            </label>
            <input
              id="lifecycle-pause-reason"
              name="reason"
              required
              minLength={3}
              maxLength={200}
              disabled={requiresReload}
              aria-invalid={Boolean(state.fieldErrors?.reason)}
              aria-describedby={
                state.fieldErrors?.reason
                  ? 'lifecycle-pause-reason-error'
                  : undefined
              }
            />
            {state.fieldErrors?.reason ? (
              <p className="form-error" id="lifecycle-pause-reason-error">
                {state.fieldErrors.reason}
              </p>
            ) : null}
            <SubmitLifecycleButton
              label="Pause paper experiment"
              pendingLabel="Pausing..."
              blocked={requiresReload}
            />
          </form>
        ) : null}

        {availability.resume ? (
          <form className="lifecycle-control-card" action={formAction}>
            <CommonFields
              action="resume"
              experimentId={experimentId}
              expectedControlStateVersion={expectedControlStateVersion}
              operationId={operationIds.resume}
            />
            <Play size={18} aria-hidden="true" />
            <h3>Resume experiment</h3>
            <p>
              Restores the exact locked replay, shadow, or live-paper simulation
              mode. Emergency pauses cannot be cleared here.
            </p>
            <SubmitLifecycleButton
              label="Resume paper experiment"
              pendingLabel="Resuming..."
              blocked={requiresReload}
            />
          </form>
        ) : null}

        {availability.complete ? (
          <form className="lifecycle-control-card" action={formAction}>
            <CommonFields
              action="complete"
              experimentId={experimentId}
              expectedControlStateVersion={expectedControlStateVersion}
              operationId={operationIds.complete}
            />
            <CheckCircle2 size={18} aria-hidden="true" />
            <h3>Complete experiment</h3>
            <p>
              Permanently closes the paper simulation lifecycle. Open simulated
              orders must already be terminal.
            </p>
            <SubmitLifecycleButton
              label="Complete paper experiment"
              pendingLabel="Completing..."
              danger
              blocked={requiresReload}
            />
          </form>
        ) : null}

        {availability.clone ? (
          <form className="lifecycle-control-card" action={formAction}>
            <CommonFields
              action="clone"
              experimentId={experimentId}
              expectedControlStateVersion={expectedControlStateVersion}
              operationId={operationIds.clone}
            />
            <Copy size={18} aria-hidden="true" />
            <h3>Clone to draft</h3>
            <p>
              Creates a separate editable draft with source provenance and
              disabled controls. The locked source remains unchanged.
            </p>
            <label className="field-label" htmlFor="lifecycle-clone-name">
              New draft name
            </label>
            <input
              id="lifecycle-clone-name"
              name="cloneName"
              required
              minLength={3}
              maxLength={100}
              defaultValue={defaultCloneName}
              disabled={requiresReload}
              aria-invalid={Boolean(state.fieldErrors?.cloneName)}
              aria-describedby={
                state.fieldErrors?.cloneName
                  ? 'lifecycle-clone-name-error'
                  : undefined
              }
            />
            {state.fieldErrors?.cloneName ? (
              <p className="form-error" id="lifecycle-clone-name-error">
                {state.fieldErrors.cloneName}
              </p>
            ) : null}
            <SubmitLifecycleButton
              label="Create disabled draft"
              pendingLabel="Cloning..."
              blocked={requiresReload}
            />
          </form>
        ) : null}
      </div>
      <p className="muted-copy">
        Expected control revision{' '}
        <span className="mono">{expectedControlStateVersion}</span>.
      </p>
    </div>
  )
}
