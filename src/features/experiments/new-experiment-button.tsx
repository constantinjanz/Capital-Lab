'use client'

import { FlaskConical, Plus, X } from 'lucide-react'
import { useActionState, useEffect, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'

import { createHostedDraftExperiment } from './actions'
import type { HostedDraftActionState } from './create-hosted-draft'

const initialHostedDraftActionState: HostedDraftActionState = {
  status: 'idle',
}

type NewExperimentButtonProps =
  | { mode?: 'mock'; operationId?: never }
  | { mode: 'supabase'; operationId: string }

function DraftSubmitButton({ mode }: { mode: 'mock' | 'supabase' }) {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      className="button button--primary"
      disabled={mode === 'supabase' && pending}
    >
      {mode === 'supabase'
        ? pending
          ? 'Creating hosted draft...'
          : 'Create hosted draft'
        : 'Create local draft'}
    </button>
  )
}

export function NewExperimentButton({
  mode = 'mock',
  operationId,
}: NewExperimentButtonProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [message, setMessage] = useState('')
  const [actionState, hostedFormAction] = useActionState(
    createHostedDraftExperiment,
    initialHostedDraftActionState,
  )

  useEffect(() => {
    if (actionState.status === 'error' && !dialog.current?.open) {
      dialog.current?.showModal()
    }
  }, [
    actionState.status,
    actionState.message,
    actionState.fieldErrors?.name,
    actionState.fieldErrors?.objective,
  ])

  function close() {
    dialog.current?.close()
  }

  return (
    <>
      <button
        type="button"
        className="button button--primary"
        onClick={() => dialog.current?.showModal()}
      >
        <Plus size={15} aria-hidden="true" />
        New draft
      </button>
      <span className="sr-only" aria-live="polite">
        {message}
      </span>
      <dialog
        ref={dialog}
        className="pause-dialog"
        onCancel={close}
        aria-labelledby="new-experiment-title"
        aria-describedby="new-experiment-description"
      >
        <div className="pause-dialog__header">
          <span
            className="pause-dialog__icon pause-dialog__icon--info"
            aria-hidden="true"
          >
            <FlaskConical size={20} />
          </span>
          <button
            type="button"
            className="icon-button"
            onClick={close}
            aria-label="Close new experiment dialog"
          >
            <X size={18} />
          </button>
        </div>
        <h2 id="new-experiment-title">Create a draft experiment</h2>
        <p id="new-experiment-description">
          {mode === 'supabase'
            ? 'The owner-only draft is persisted with EUR 100000.00000000 and all execution controls disabled.'
            : 'The draft inherits safe paper-only defaults. Rules remain editable until the experiment starts.'}
        </p>
        <form
          action={mode === 'supabase' ? hostedFormAction : undefined}
          onSubmit={
            mode === 'mock'
              ? (event) => {
                  event.preventDefault()
                  setMessage('Draft created locally with safe defaults.')
                  close()
                }
              : undefined
          }
        >
          {mode === 'supabase' ? (
            <input type="hidden" name="operationId" value={operationId} />
          ) : null}
          {mode === 'supabase' && actionState.message ? (
            <p className="form-error" role="alert">
              {actionState.message}
            </p>
          ) : null}
          <label className="field-label" htmlFor="experiment-name">
            Experiment name
          </label>
          <input
            id="experiment-name"
            name="name"
            required
            minLength={3}
            maxLength={100}
            defaultValue="New event study"
            aria-invalid={Boolean(actionState.fieldErrors?.name)}
            aria-describedby={
              actionState.fieldErrors?.name
                ? 'experiment-name-error'
                : undefined
            }
          />
          {actionState.fieldErrors?.name ? (
            <p className="form-error" id="experiment-name-error">
              {actionState.fieldErrors.name}
            </p>
          ) : null}
          <label className="field-label" htmlFor="objective">
            Objective
          </label>
          <textarea
            id="objective"
            name="objective"
            rows={3}
            required
            minLength={10}
            maxLength={1000}
            defaultValue="Evaluate a point-in-time event hypothesis within conservative risk limits."
            aria-invalid={Boolean(actionState.fieldErrors?.objective)}
            aria-describedby={
              actionState.fieldErrors?.objective
                ? 'experiment-objective-error'
                : undefined
            }
          />
          {actionState.fieldErrors?.objective ? (
            <p className="form-error" id="experiment-objective-error">
              {actionState.fieldErrors.objective}
            </p>
          ) : null}
          <div className="pause-dialog__actions">
            <button
              type="button"
              className="button button--secondary"
              onClick={close}
            >
              Cancel
            </button>
            <DraftSubmitButton mode={mode} />
          </div>
        </form>
      </dialog>
    </>
  )
}
