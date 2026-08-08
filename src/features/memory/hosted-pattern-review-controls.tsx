'use client'

import { RefreshCw, ShieldCheck } from 'lucide-react'
import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'

import { reviewHostedPatternLifecycle } from '@/features/memory/actions'
import type { HostedPatternLifecycleStatus } from '@/features/memory/hosted-learning-snapshot'
import {
  type HostedPatternReviewAction,
  hostedPatternReviewConfirmations,
  initialHostedPatternReviewActionState,
} from '@/features/memory/hosted-pattern-review'

export type HostedPatternReviewOperationIds = Partial<
  Record<HostedPatternReviewAction, string>
>

const actionsByStatus: Record<
  HostedPatternLifecycleStatus,
  HostedPatternReviewAction[]
> = {
  proposed: ['start_shadow', 'reject'],
  shadow: ['mark_eligible', 'reject', 'retire'],
  eligible: ['reject', 'retire'],
  active: ['retire'],
  rejected: [],
  retired: [],
}

const actionCopy: Record<
  HostedPatternReviewAction,
  { label: string; pending: string; description: string; danger?: boolean }
> = {
  start_shadow: {
    label: 'Start shadow review',
    pending: 'Starting review...',
    description:
      'Moves the hypothesis into observation-only shadow review. It does not run an agent or create an assignment.',
  },
  mark_eligible: {
    label: 'Mark eligible',
    pending: 'Checking gate...',
    description:
      'Recomputes the fixed evidence gate in the database, then records owner eligibility without activating it.',
  },
  reject: {
    label: 'Reject pattern',
    pending: 'Rejecting...',
    description:
      'Records an owner rejection and preserves the evidence and hypothesis for audit.',
    danger: true,
  },
  retire: {
    label: 'Retire pattern',
    pending: 'Retiring...',
    description:
      'Closes further lifecycle consideration while preserving all prior evidence and reviews.',
    danger: true,
  },
}

function ReviewSubmitButton({
  action,
  blocked,
}: {
  action: HostedPatternReviewAction
  blocked: boolean
}) {
  const { pending } = useFormStatus()
  const copy = actionCopy[action]
  return (
    <button
      className={`button ${copy.danger ? 'button--danger' : 'button--secondary'}`}
      type="submit"
      disabled={blocked || pending}
    >
      {pending ? copy.pending : copy.label}
    </button>
  )
}

export function HostedPatternReviewControls({
  patternId,
  patternName,
  expectedStatus,
  operationIds,
}: {
  patternId: string
  patternName: string
  expectedStatus: HostedPatternLifecycleStatus
  operationIds: HostedPatternReviewOperationIds
}) {
  const [state, formAction] = useActionState(
    reviewHostedPatternLifecycle,
    initialHostedPatternReviewActionState,
  )
  const actions = actionsByStatus[expectedStatus].filter(
    (action) => operationIds[action] !== undefined,
  )
  const blocked = state.status === 'unknown' || state.status === 'success'

  if (actions.length === 0) {
    return (
      <p className="muted-copy">
        This lifecycle is terminal in the owner review boundary.
      </p>
    )
  }

  return (
    <div className="lifecycle-controls">
      <p className="safe-note">
        <ShieldCheck size={14} aria-hidden="true" /> Reviews change only the
        hypothesis lifecycle. Agents, assignments, allocations, orders, and
        fills remain unchanged.
      </p>
      {state.message ? (
        <p
          className={state.status === 'success' ? 'safe-note' : 'form-error'}
          role={state.status === 'success' ? 'status' : 'alert'}
        >
          {state.message}
        </p>
      ) : null}
      {blocked ? (
        <button
          className="button button--primary"
          type="button"
          onClick={() => window.location.reload()}
        >
          <RefreshCw size={14} aria-hidden="true" /> Refresh Memory
        </button>
      ) : null}
      <div className="lifecycle-control-grid">
        {actions.map((action) => {
          const copy = actionCopy[action]
          const operationId = operationIds[action]
          if (!operationId) return null
          const fieldId = `${patternId}-${action}`
          const needsReason = action === 'reject' || action === 'retire'
          return (
            <form
              className="lifecycle-control-card"
              action={formAction}
              key={action}
            >
              <input type="hidden" name="operationId" value={operationId} />
              <input type="hidden" name="patternId" value={patternId} />
              <input
                type="hidden"
                name="expectedStatus"
                value={expectedStatus}
              />
              <input type="hidden" name="action" value={action} />
              <h4>{copy.label}</h4>
              <p>{copy.description}</p>
              <label
                className="field-label"
                htmlFor={`${fieldId}-confirmation`}
              >
                Enter {hostedPatternReviewConfirmations[action]}
              </label>
              <input
                id={`${fieldId}-confirmation`}
                name="confirmation"
                required
                autoComplete="off"
                disabled={blocked}
                aria-invalid={Boolean(state.fieldErrors?.confirmation)}
              />
              {needsReason ? (
                <>
                  <label className="field-label" htmlFor={`${fieldId}-reason`}>
                    Owner reason
                  </label>
                  <input
                    id={`${fieldId}-reason`}
                    name="reason"
                    required
                    minLength={3}
                    maxLength={200}
                    disabled={blocked}
                    aria-invalid={Boolean(state.fieldErrors?.reason)}
                  />
                </>
              ) : null}
              <ReviewSubmitButton action={action} blocked={blocked} />
            </form>
          )
        })}
      </div>
      <p className="muted-copy">
        Reviewing <span className="mono">{patternName}</span> from expected
        status <span className="mono">{expectedStatus}</span>.
      </p>
    </div>
  )
}
