import { FlaskConical } from 'lucide-react'

export function DataModeNotice({
  compact = false,
  mode = 'mock',
}: {
  compact?: boolean
  mode?: 'mock' | 'supabase'
}) {
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
        {mode === 'mock' ? (
          <>
            <strong>Synthetic fixture data.</strong> No live price, order,
            model, or broker connection is active.
          </>
        ) : (
          <>
            <strong>Hosted database connected.</strong> Market ingestion,
            scheduler, agent, and broker connections remain disabled.
          </>
        )}
      </span>
    </div>
  )
}
