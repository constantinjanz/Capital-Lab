'use client'

import { CheckCircle2, Copy, Pause, Play, ShieldCheck } from 'lucide-react'
import { useState } from 'react'

import type { ExperimentStatus } from '@/lib/mock/types'

export function ExperimentControls({ status }: { status: ExperimentStatus }) {
  const [message, setMessage] = useState('')

  const action =
    status === 'draft'
      ? 'Validate configuration'
      : status === 'paused'
        ? 'Resume experiment'
        : 'Pause experiment'
  const ActionIcon =
    status === 'draft' ? ShieldCheck : status === 'paused' ? Play : Pause

  return (
    <div>
      <div className="button-row">
        <button
          className="button button--primary"
          type="button"
          onClick={() => setMessage(`${action} completed in local mock mode.`)}
        >
          <ActionIcon size={15} aria-hidden="true" />
          {action}
        </button>
        <button
          className="button button--secondary"
          type="button"
          onClick={() =>
            setMessage('Configuration cloned into a new local draft.')
          }
        >
          <Copy size={15} aria-hidden="true" />
          Clone configuration
        </button>
      </div>
      <p className="action-message" aria-live="polite">
        {message ? (
          <>
            <CheckCircle2 size={14} aria-hidden="true" />
            {message}
          </>
        ) : (
          'Controls are deterministic local demonstrations; no remote state is changed.'
        )}
      </p>
    </div>
  )
}
