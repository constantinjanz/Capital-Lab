import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'

import type { Metric } from '@/lib/mock/types'

export function MetricCard({ metric }: { metric: Metric }) {
  const tone = metric.tone ?? 'neutral'
  const TrendIcon =
    tone === 'positive'
      ? ArrowUpRight
      : tone === 'negative'
        ? ArrowDownRight
        : Minus

  return (
    <article className="metric-card">
      <div className="metric-card__topline">
        <p>{metric.label}</p>
        <TrendIcon aria-hidden="true" size={15} />
      </div>
      <p className={`metric-card__value text-${tone}`}>{metric.value}</p>
      <p className="metric-card__detail">{metric.detail}</p>
    </article>
  )
}
