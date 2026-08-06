'use client'

import { FlaskConical, Plus, X } from 'lucide-react'
import { useRef, useState } from 'react'

export function NewExperimentButton({
  mode = 'mock',
}: {
  mode?: 'mock' | 'supabase'
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [message, setMessage] = useState('')

  function close() {
    dialog.current?.close()
  }

  return (
    <>
      <button
        type="button"
        className="button button--primary"
        disabled={mode === 'supabase'}
        title={
          mode === 'supabase'
            ? 'Hosted experiment writes remain disabled during read-only review'
            : undefined
        }
        onClick={() => dialog.current?.showModal()}
      >
        <Plus size={15} aria-hidden="true" />
        {mode === 'supabase' ? 'Draft creation locked' : 'New draft'}
      </button>
      <span className="sr-only" aria-live="polite">
        {message}
      </span>
      <dialog ref={dialog} className="pause-dialog" onCancel={close}>
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
        <h2>Create a draft experiment</h2>
        <p>
          The draft inherits safe paper-only defaults. Rules remain editable
          until the experiment starts.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            setMessage('Draft created locally with safe defaults.')
            close()
          }}
        >
          <label className="field-label" htmlFor="experiment-name">
            Experiment name
          </label>
          <input id="experiment-name" required defaultValue="New event study" />
          <label className="field-label" htmlFor="objective">
            Objective
          </label>
          <textarea
            id="objective"
            rows={3}
            defaultValue="Evaluate a point-in-time event hypothesis within conservative risk limits."
          />
          <div className="pause-dialog__actions">
            <button
              type="button"
              className="button button--secondary"
              onClick={close}
            >
              Cancel
            </button>
            <button type="submit" className="button button--primary">
              Create local draft
            </button>
          </div>
        </form>
      </dialog>
    </>
  )
}
