import type { ReactNode } from 'react'
import { clsx } from 'clsx'

export function Panel({
  title,
  eyebrow,
  action,
  children,
  className,
  compact = false,
}: {
  title?: string
  eyebrow?: string
  action?: ReactNode
  children: ReactNode
  className?: string
  compact?: boolean
}) {
  return (
    <section className={clsx('panel', compact && 'panel--compact', className)}>
      {title || eyebrow || action ? (
        <div className="panel__header">
          <div>
            {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
            {title ? <h2 className="panel__title">{title}</h2> : null}
          </div>
          {action ? <div className="panel__action">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}
