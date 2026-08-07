'use client'

import { Database, ShieldCheck } from 'lucide-react'
import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'

import { configureHostedMarketManifest } from '@/features/markets/actions'
import { initialHostedMarketConfigurationActionState } from '@/features/markets/configure-hosted-market'

function ConfigureButton({ completed }: { completed: boolean }) {
  const { pending } = useFormStatus()

  return (
    <button
      className="button button--primary"
      type="submit"
      disabled={pending || completed}
    >
      <Database size={15} aria-hidden="true" />
      {pending
        ? 'Saving reviewed configuration...'
        : completed
          ? 'Configuration saved'
          : 'Save reviewed market configuration'}
    </button>
  )
}

export function HostedMarketSetupControl({
  operationId,
}: {
  operationId: string
}) {
  const [actionState, formAction] = useActionState(
    configureHostedMarketManifest,
    initialHostedMarketConfigurationActionState,
  )
  const completed = actionState.status === 'success'

  return (
    <form action={formAction} aria-label="Configure hosted market scope">
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
          <ShieldCheck size={14} aria-hidden="true" /> This creates or restores
          the reviewed five-instrument universe and data-only Alpaca IEX
          contract. Initial setup is disabled; later runs never change source or
          policy activation, fetch data, add credentials, or enable ingestion.
        </p>
        <ConfigureButton completed={completed} />
      </div>
    </form>
  )
}
