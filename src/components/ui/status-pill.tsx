import type { ReactNode } from 'react'
import { clsx } from 'clsx'

import type { Tone } from '@/lib/mock/types'

export function StatusPill({
  children,
  tone = 'neutral',
  dot = false,
  className,
}: {
  children: ReactNode
  tone?: Tone
  dot?: boolean
  className?: string
}) {
  return (
    <span className={clsx('status-pill', `status-pill--${tone}`, className)}>
      {dot ? <span className="status-pill__dot" aria-hidden="true" /> : null}
      {children}
    </span>
  )
}
