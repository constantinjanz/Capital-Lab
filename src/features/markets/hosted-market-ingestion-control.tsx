'use client'

import { DatabaseZap, Power, ShieldCheck } from 'lucide-react'
import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'

import { StatusPill } from '@/components/ui/status-pill'
import {
  runHostedAlpacaIngestion,
  setHostedAlpacaSourceState,
} from '@/features/markets/actions'
import {
  HOSTED_ALPACA_SYMBOLS,
  initialHostedMarketMutationActionState,
  type HostedMarketIngestionReadiness,
  type HostedMarketMutationActionState,
} from '@/features/markets/hosted-market-ingestion'
import { formatUtc } from '@/lib/formatting'

function isSuccessful(state: HostedMarketMutationActionState): boolean {
  return state.status === 'success' || state.status === 'replayed'
}

function ActionResult({ state }: { state: HostedMarketMutationActionState }) {
  if (!state.message) return null
  const successful = isSuccessful(state)

  return (
    <p
      className={successful ? 'form-success' : 'form-error'}
      role={successful ? 'status' : 'alert'}
    >
      {state.message}
    </p>
  )
}

function SourceLifecycleButton({ sourceEnabled }: { sourceEnabled: boolean }) {
  const { pending } = useFormStatus()

  return (
    <button
      className="button button--secondary"
      type="submit"
      disabled={pending}
    >
      <Power size={15} aria-hidden="true" />
      {pending
        ? sourceEnabled
          ? 'Disabling source...'
          : 'Enabling source...'
        : sourceEnabled
          ? 'Disable Alpaca IEX source'
          : 'Enable Alpaca IEX source'}
    </button>
  )
}

function IngestionButton({ enabled }: { enabled: boolean }) {
  const { pending } = useFormStatus()

  return (
    <button
      className="button button--primary"
      type="submit"
      disabled={pending || !enabled}
    >
      <DatabaseZap size={15} aria-hidden="true" />
      {pending ? 'Fetching market evidence...' : 'Fetch reviewed IEX batch'}
    </button>
  )
}

export function HostedMarketIngestionControl({
  lifecycleOperationId,
  ingestionOperationId,
  readiness,
  sourceEnabled,
  windowStart,
  windowEnd,
}: {
  lifecycleOperationId: string
  ingestionOperationId: string
  readiness: HostedMarketIngestionReadiness
  sourceEnabled: boolean
  windowStart: string
  windowEnd: string
}) {
  const [lifecycleState, lifecycleAction] = useActionState(
    setHostedAlpacaSourceState,
    initialHostedMarketMutationActionState,
  )
  const [ingestionState, ingestionAction] = useActionState(
    runHostedAlpacaIngestion,
    initialHostedMarketMutationActionState,
  )
  const ingestionEnabled = readiness.ready && sourceEnabled

  return (
    <div>
      <dl className="definition-list">
        <div>
          <dt>Reviewed scope</dt>
          <dd>{HOSTED_ALPACA_SYMBOLS.join(', ')} · Alpaca IEX</dd>
        </div>
        <div>
          <dt>Source lifecycle</dt>
          <dd>
            <StatusPill tone={sourceEnabled ? 'positive' : 'neutral'}>
              {sourceEnabled ? 'Enabled' : 'Disabled'}
            </StatusPill>
          </dd>
        </div>
        <div>
          <dt>Server environment</dt>
          <dd>
            <StatusPill tone={readiness.ready ? 'positive' : 'warning'}>
              {readiness.ready ? 'Ready' : 'Blocked'}
            </StatusPill>
          </dd>
        </div>
        <div>
          <dt>Completed-minute window</dt>
          <dd>
            <time dateTime={windowStart}>{formatUtc(windowStart)}</time>–
            <time dateTime={windowEnd}>{formatUtc(windowEnd)}</time>
          </dd>
        </div>
      </dl>

      <p className="safe-note">
        <ShieldCheck size={14} aria-hidden="true" /> {readiness.message} No
        credential values are sent to or displayed by this page.
      </p>

      <form action={lifecycleAction} aria-label="Set Alpaca IEX source state">
        <input type="hidden" name="operationId" value={lifecycleOperationId} />
        <input
          type="hidden"
          name="enabled"
          value={sourceEnabled ? 'false' : 'true'}
        />
        <ActionResult state={lifecycleState} />
        <div className="panel-action-row">
          <p className="safe-note">
            Source activation is an explicit owner action. It only changes the
            reviewed data-source lifecycle and never fetches data or links a
            brokerage account.
          </p>
          <SourceLifecycleButton sourceEnabled={sourceEnabled} />
        </div>
      </form>

      <form action={ingestionAction} aria-label="Run Alpaca IEX ingestion">
        <input type="hidden" name="operationId" value={ingestionOperationId} />
        <input type="hidden" name="windowStart" value={windowStart} />
        <input type="hidden" name="windowEnd" value={windowEnd} />
        <ActionResult state={ingestionState} />
        {ingestionState.summary ? (
          <dl className="definition-list" aria-label="Ingestion result">
            <div>
              <dt>Records seen</dt>
              <dd>{ingestionState.summary.recordsSeen}</dd>
            </div>
            <div>
              <dt>Inserted</dt>
              <dd>{ingestionState.summary.recordsInserted}</dd>
            </div>
            <div>
              <dt>Deduplicated</dt>
              <dd>{ingestionState.summary.recordsDeduplicated}</dd>
            </div>
            <div>
              <dt>Evidence available</dt>
              <dd>
                <time dateTime={ingestionState.summary.availableAt}>
                  {formatUtc(ingestionState.summary.availableAt)}
                </time>
              </dd>
            </div>
          </dl>
        ) : null}
        <div className="panel-action-row">
          <p className="safe-note safe-note--warning">
            Fetches latest quotes and completed raw 1m bars for the five IEX
            symbols only. No scheduler, AI, orders, or exchange-calendar data is
            involved.
          </p>
          <IngestionButton enabled={ingestionEnabled} />
        </div>
      </form>
    </div>
  )
}
