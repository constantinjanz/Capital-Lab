'use client'

import { History, PlayCircle, ShieldCheck } from 'lucide-react'
import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'

import { formatStatus, formatUtc } from '@/lib/formatting'

import { runHostedManualCycle } from './actions'
import {
  initialHostedManualCycleActionState,
  type HostedManualCycleState,
  type HostedManualCycleUnavailableReason,
} from './hosted-manual-cycle'

const unavailableCopy: Record<HostedManualCycleUnavailableReason, string> = {
  scheduler_provider_not_manual:
    'The reviewed manual scheduler provider is not configured.',
  experiment_not_active: 'Only an active paper experiment can run a cycle.',
  execution_mode_not_supported:
    'This control is limited to replay and shadow paper modes.',
  locked_version_unavailable:
    'The immutable experiment version could not be verified.',
  controls_unavailable: 'The hosted control revision could not be verified.',
  remote_scheduler_must_remain_disabled:
    'Disable the remote scheduler before using the owner-only manual envelope.',
  agent_must_remain_disabled:
    'The agent must remain disabled for this reviewed cycle envelope.',
  experiment_emergency_paused:
    'The emergency pause blocks every new paper cycle.',
  paper_account_not_active: 'The paper simulation account is not active.',
  locked_runtime_contract_unavailable:
    'The locked paper-only runtime manifest could not be verified.',
}

function CycleButton() {
  const { pending } = useFormStatus()
  return (
    <button className="button button--primary" type="submit" disabled={pending}>
      <PlayCircle size={15} aria-hidden="true" />
      {pending ? 'Recording cycle envelope...' : 'Run reviewed paper cycle'}
    </button>
  )
}

export function HostedManualCycleControls({
  cycleState,
  operationId,
}: {
  cycleState: HostedManualCycleState
  operationId: string
}) {
  const [actionState, formAction] = useActionState(
    runHostedManualCycle,
    initialHostedManualCycleActionState,
  )

  if (cycleState.status === 'unavailable') {
    return (
      <p className="form-error" role="alert">
        Manual cycle state could not be verified. Reload before taking any
        action.
      </p>
    )
  }

  const requiresReload = actionState.status === 'unknown'
  const confirmationError = actionState.fieldErrors?.confirmation

  return (
    <div className="lifecycle-controls">
      <p className="safe-note">
        <ShieldCheck size={14} aria-hidden="true" /> This owner-only action
        records one database-stamped 15-minute scheduling decision and one
        skipped simulator journal. Provider fetches, AI calls, orders, fills,
        and financial writes remain disabled.
      </p>
      {cycleState.lastRun ? (
        <div className="configuration-grid">
          <div className="configuration-item">
            <span>Latest cycle</span>
            <strong>{formatStatus(cycleState.lastRun.status)}</strong>
            <small>{formatUtc(cycleState.lastRun.decisionAt)}</small>
          </div>
          <div className="configuration-item">
            <span>Safe skip reason</span>
            <strong>{formatStatus(cycleState.lastRun.reason)}</strong>
            <small>No provider, model, order, or fill side effect</small>
          </div>
          <div className="configuration-item">
            <span>Scheduler run</span>
            <strong className="mono">
              {cycleState.lastRun.schedulerRunId}
            </strong>
            <small>Durable owner audit reference</small>
          </div>
          <div className="configuration-item">
            <span>Simulator journal</span>
            <strong className="mono">
              {cycleState.lastRun.simulatorRunId}
            </strong>
            <small>Skipped with zero financial side effects</small>
          </div>
          <div className="configuration-item">
            <span>Slot</span>
            <strong className="mono">{cycleState.lastRun.slotKey}</strong>
            <small>Duplicate deliveries reuse this result</small>
          </div>
        </div>
      ) : (
        <p className="muted-copy">
          <History size={14} aria-hidden="true" /> No hosted paper cycle has
          been recorded for this experiment.
        </p>
      )}
      {cycleState.ready ? (
        <form className="lifecycle-control-card" action={formAction}>
          <input type="hidden" name="operationId" value={operationId} />
          <input
            type="hidden"
            name="experimentId"
            value={cycleState.experimentId}
          />
          <input
            type="hidden"
            name="expectedControlStateVersion"
            value={cycleState.controlStateVersion}
          />
          <input
            type="hidden"
            name="decisionAt"
            value={cycleState.decisionAt}
          />
          <PlayCircle size={18} aria-hidden="true" />
          <h3>Manual scheduler envelope</h3>
          <p>
            The database checks the official XNAS/ARCX session at submission
            time. The reviewed market runtime and agent stay off, so the durable
            outcome is a safe skip.
          </p>
          <label className="field-label" htmlFor="manual-cycle-confirmation">
            Enter RUN PAPER CYCLE
          </label>
          <input
            id="manual-cycle-confirmation"
            name="confirmation"
            required
            autoComplete="off"
            disabled={requiresReload}
            aria-invalid={Boolean(confirmationError)}
            aria-describedby={
              confirmationError ? 'manual-cycle-confirmation-error' : undefined
            }
          />
          {confirmationError ? (
            <p className="form-error" id="manual-cycle-confirmation-error">
              {confirmationError}
            </p>
          ) : null}
          {actionState.message ? (
            <p className="form-error" role="alert">
              {actionState.message}
            </p>
          ) : null}
          {requiresReload ? (
            <button
              className="button button--primary"
              type="button"
              onClick={() => window.location.reload()}
            >
              Reload cycle evidence
            </button>
          ) : (
            <CycleButton />
          )}
        </form>
      ) : (
        <p className="safe-note">
          {cycleState.reason
            ? unavailableCopy[cycleState.reason]
            : 'The manual cycle is currently unavailable.'}
        </p>
      )}
      <p className="muted-copy">
        Scheduler provider {cycleState.schedulerProvider ?? 'unconfigured'} ·
        control revision{' '}
        <span className="mono">{cycleState.controlStateVersion}</span> · state
        checked {formatUtc(cycleState.decisionAt)}
      </p>
    </div>
  )
}
