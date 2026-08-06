'use client'

import { PauseCircle, ShieldAlert, X } from 'lucide-react'
import { useRef, useState } from 'react'

export function EmergencyPauseButton() {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [paused, setPaused] = useState(false)

  function closeDialog() {
    dialogRef.current?.close()
  }

  function confirmPause() {
    setPaused(true)
    closeDialog()
  }

  return (
    <>
      <button
        type="button"
        className="emergency-button"
        disabled={paused}
        onClick={() => dialogRef.current?.showModal()}
      >
        {paused ? (
          <PauseCircle size={16} aria-hidden="true" />
        ) : (
          <ShieldAlert size={16} aria-hidden="true" />
        )}
        {paused ? 'Paused locally' : 'Emergency pause'}
      </button>
      <span className="sr-only" aria-live="polite">
        {paused ? 'The mock experiment is paused in this interface.' : ''}
      </span>

      <dialog className="pause-dialog" ref={dialogRef} onCancel={closeDialog}>
        <div className="pause-dialog__header">
          <span className="pause-dialog__icon" aria-hidden="true">
            <ShieldAlert size={20} />
          </span>
          <button
            className="icon-button"
            type="button"
            onClick={closeDialog}
            aria-label="Close pause dialog"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <h2>Pause Northstar Event Lab?</h2>
        <p>
          This mock control demonstrates the production safety action. It stops
          new model calls and simulated orders while preserving positions and
          history.
        </p>
        <label className="field-label" htmlFor="pause-reason">
          Reason
        </label>
        <select id="pause-reason" defaultValue="manual-review">
          <option value="manual-review">Manual risk review</option>
          <option value="data-quality">Data quality concern</option>
          <option value="budget">Budget review</option>
        </select>
        <div className="pause-dialog__actions">
          <button
            type="button"
            className="button button--secondary"
            onClick={closeDialog}
          >
            Keep running
          </button>
          <button
            type="button"
            className="button button--danger"
            onClick={confirmPause}
          >
            Pause mock experiment
          </button>
        </div>
      </dialog>
    </>
  )
}
