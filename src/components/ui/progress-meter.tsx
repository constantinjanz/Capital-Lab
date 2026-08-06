import { clsx } from 'clsx'

import type { Tone } from '@/lib/mock/types'

export function ProgressMeter({
  value,
  label,
  tone = 'info',
}: {
  value: number
  label: string
  tone?: Tone
}) {
  const boundedValue = Math.max(0, Math.min(value, 100))

  return (
    <div className="progress-meter" aria-label={`${label}: ${value}%`}>
      <div className="progress-meter__track" aria-hidden="true">
        <span
          className={clsx(
            'progress-meter__fill',
            `progress-meter__fill--${tone}`,
          )}
          style={{ width: `${boundedValue}%` }}
        />
      </div>
    </div>
  )
}
