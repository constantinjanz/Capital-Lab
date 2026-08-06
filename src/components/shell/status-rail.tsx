import { Activity, Bot, Clock3, Database, DollarSign } from 'lucide-react'

import { formatUtc } from '@/lib/formatting'
import type { ShellViewModel } from '@/lib/mock/types'

export function StatusRail({ shell }: { shell: ShellViewModel }) {
  return (
    <div className="status-rail" aria-label="System status">
      <div className="status-rail__item">
        <Clock3 size={14} aria-hidden="true" />
        <span>
          <strong>Market {shell.market.state}</strong>
          {shell.market.detail}
        </span>
      </div>
      <div className="status-rail__item status-rail__item--mock">
        <Database size={14} aria-hidden="true" />
        <span>
          <strong>Synthetic mock</strong>
          {formatUtc(shell.market.asOf)}
        </span>
      </div>
      <div className="status-rail__item">
        <Bot size={14} aria-hidden="true" />
        <span>
          <strong>Agent {shell.agentMode}</strong>Paid calls disabled
        </span>
      </div>
      <div className="status-rail__item">
        <Activity size={14} aria-hidden="true" />
        <span>
          <strong>Scheduler {shell.scheduler.state}</strong>
          {shell.scheduler.detail}
        </span>
      </div>
      <div className="status-rail__item status-rail__item--spend">
        <DollarSign size={14} aria-hidden="true" />
        <span>
          <strong>{shell.spend.daily} today</strong>
          {shell.spend.monthly} month · {shell.spend.lifetime} lifetime
        </span>
      </div>
    </div>
  )
}
