'use client'

import { Pencil, X } from 'lucide-react'
import { useActionState, useEffect, useRef } from 'react'
import { useFormStatus } from 'react-dom'

import { updateHostedDraftExperiment } from './actions'
import { initialHostedDraftUpdateActionState } from './update-hosted-draft'

function SaveDraftButton({ blocked }: { blocked: boolean }) {
  const { pending } = useFormStatus()

  return (
    <button
      className="button button--primary"
      type="submit"
      disabled={pending || blocked}
    >
      {pending ? 'Saving draft...' : 'Save draft'}
    </button>
  )
}

export function HostedDraftEditor({
  experimentId,
  operationId,
  expectedRevision,
  name,
  objective,
}: {
  experimentId: string
  operationId: string
  expectedRevision: string
  name: string
  objective: string
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [actionState, formAction] = useActionState(
    updateHostedDraftExperiment,
    initialHostedDraftUpdateActionState,
  )
  const requiresReload = actionState.status === 'unknown'

  useEffect(() => {
    if (actionState.status !== 'idle' && !dialog.current?.open) {
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
        className="button button--secondary"
        type="button"
        onClick={() => dialog.current?.showModal()}
      >
        <Pencil size={15} aria-hidden="true" />
        Edit draft metadata
      </button>
      <dialog
        ref={dialog}
        className="pause-dialog"
        onCancel={close}
        aria-labelledby="edit-draft-title"
        aria-describedby="edit-draft-description"
      >
        <div className="pause-dialog__header">
          <span
            className="pause-dialog__icon pause-dialog__icon--info"
            aria-hidden="true"
          >
            <Pencil size={20} />
          </span>
          <button
            type="button"
            className="icon-button"
            onClick={close}
            aria-label="Close draft editor"
          >
            <X size={18} />
          </button>
        </div>
        <h2 id="edit-draft-title">Edit draft metadata</h2>
        <p id="edit-draft-description">
          Name and objective remain editable until start. Capital, controls,
          lifecycle, and execution settings are unchanged by this save.
        </p>
        <form action={formAction}>
          <input type="hidden" name="operationId" value={operationId} />
          <input type="hidden" name="experimentId" value={experimentId} />
          <input
            type="hidden"
            name="expectedRevision"
            value={expectedRevision}
          />
          {actionState.message ? (
            <p className="form-error" role="alert">
              {actionState.message}
            </p>
          ) : null}
          <label className="field-label" htmlFor="hosted-draft-name">
            Experiment name
          </label>
          <input
            id="hosted-draft-name"
            name="name"
            required
            minLength={3}
            maxLength={100}
            defaultValue={name}
            disabled={requiresReload}
            aria-invalid={Boolean(actionState.fieldErrors?.name)}
            aria-describedby={
              actionState.fieldErrors?.name
                ? 'hosted-draft-name-error'
                : undefined
            }
          />
          {actionState.fieldErrors?.name ? (
            <p className="form-error" id="hosted-draft-name-error">
              {actionState.fieldErrors.name}
            </p>
          ) : null}
          <label className="field-label" htmlFor="hosted-draft-objective">
            Objective
          </label>
          <textarea
            id="hosted-draft-objective"
            name="objective"
            rows={5}
            required
            minLength={10}
            maxLength={1000}
            defaultValue={objective}
            disabled={requiresReload}
            aria-invalid={Boolean(actionState.fieldErrors?.objective)}
            aria-describedby={
              actionState.fieldErrors?.objective
                ? 'hosted-draft-objective-error'
                : undefined
            }
          />
          {actionState.fieldErrors?.objective ? (
            <p className="form-error" id="hosted-draft-objective-error">
              {actionState.fieldErrors.objective}
            </p>
          ) : null}
          <p className="muted-copy">
            Saving exact draft revision{' '}
            <span className="mono">{expectedRevision}</span>.
          </p>
          <div className="pause-dialog__actions">
            <button
              className="button button--secondary"
              type="button"
              onClick={close}
            >
              Cancel
            </button>
            {requiresReload ? (
              <button
                className="button button--primary"
                type="button"
                onClick={() => window.location.reload()}
              >
                Reload current draft
              </button>
            ) : (
              <SaveDraftButton blocked={requiresReload} />
            )}
          </div>
        </form>
      </dialog>
    </>
  )
}
