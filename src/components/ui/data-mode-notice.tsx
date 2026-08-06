import { FlaskConical } from 'lucide-react'

export function DataModeNotice({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={
        compact
          ? 'data-mode-notice data-mode-notice--compact'
          : 'data-mode-notice'
      }
    >
      <FlaskConical size={15} aria-hidden="true" />
      <span>
        <strong>Synthetic fixture data.</strong> No live price, order, model, or
        broker connection is active.
      </span>
    </div>
  )
}
