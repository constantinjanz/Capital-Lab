import { AlertTriangle, RotateCcw } from 'lucide-react'

export function ErrorPanel({
  title,
  description,
  digest,
  onRetry,
}: {
  title: string
  description: string
  digest?: string
  onRetry?: () => void
}) {
  return (
    <div className="error-panel" role="alert">
      <span className="error-panel__icon" aria-hidden="true">
        <AlertTriangle size={22} />
      </span>
      <div>
        <p className="eyebrow">Safe degraded state</p>
        <h1>{title}</h1>
        <p>{description}</p>
        {digest ? <code>Reference: {digest}</code> : null}
        {onRetry ? (
          <button
            className="button button--secondary"
            type="button"
            onClick={onRetry}
          >
            <RotateCcw size={15} aria-hidden="true" />
            Try again
          </button>
        ) : null}
      </div>
    </div>
  )
}
