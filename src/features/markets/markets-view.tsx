import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Radio,
  ShieldX,
} from 'lucide-react'

import { DataModeNotice } from '@/components/ui/data-mode-notice'
import { MetricCard } from '@/components/ui/metric-card'
import { PageHeader } from '@/components/ui/page-header'
import { Panel } from '@/components/ui/panel'
import { StatusPill } from '@/components/ui/status-pill'
import { TableShell } from '@/components/ui/table-shell'
import type { MarketViewModel } from '@/lib/mock/types'

export function MarketsView({ data }: { data: MarketViewModel }) {
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Market state"
        title="Markets"
        description="Point-in-time quotes, sessions, universe breadth, and provider freshness used by the simulator."
        actions={
          <StatusPill tone="positive" dot>
            Market open
          </StatusPill>
        }
      />
      <DataModeNotice />
      <section className="session-banner" aria-label="Current market session">
        <span className="session-banner__icon">
          <Clock3 size={20} aria-hidden="true" />
        </span>
        <div>
          <p className="eyebrow">Current session</p>
          <h2>{data.session.name}</h2>
          <p>{data.session.window}</p>
        </div>
        <div className="session-banner__remaining">
          <strong>{data.session.elapsed}</strong>
          <span>Mock clock fixed at 14:45 UTC</span>
        </div>
      </section>
      <section
        className="metric-grid metric-grid--four"
        aria-label="Market breadth summary"
      >
        {data.breadth.map((item) => (
          <MetricCard key={item.label} metric={item} />
        ))}
      </section>
      <Panel
        eyebrow="Tradable universe"
        title="Quote monitor"
        action={<span className="as-of">Stale threshold · 5 minutes</span>}
      >
        <TableShell caption="Point-in-time market quotes">
          <thead>
            <tr>
              <th scope="col">Instrument</th>
              <th scope="col" className="numeric">
                Bid
              </th>
              <th scope="col" className="numeric">
                Ask
              </th>
              <th scope="col" className="numeric">
                Last
              </th>
              <th scope="col" className="numeric">
                Change
              </th>
              <th scope="col" className="numeric">
                Volume
              </th>
              <th scope="col">Freshness</th>
            </tr>
          </thead>
          <tbody>
            {data.quotes.map((quote) => (
              <tr
                key={quote.symbol}
                className={
                  quote.status === 'stale' ? 'table-row--warning' : undefined
                }
              >
                <td>
                  <div className="symbol-cell">
                    <strong>{quote.symbol}</strong>
                    <span>{quote.name}</span>
                  </div>
                </td>
                <td className="numeric mono">{quote.bid}</td>
                <td className="numeric mono">{quote.ask}</td>
                <td className="numeric mono">{quote.last}</td>
                <td
                  className={`numeric mono ${quote.change.startsWith('+') ? 'text-positive' : 'text-negative'}`}
                >
                  {quote.change}
                </td>
                <td className="numeric mono">{quote.volume}</td>
                <td>
                  <StatusPill
                    tone={quote.status === 'fresh' ? 'positive' : 'warning'}
                    dot
                  >
                    {quote.freshness}
                  </StatusPill>
                </td>
              </tr>
            ))}
          </tbody>
        </TableShell>
        <p className="safe-note safe-note--warning">
          <ShieldX size={14} aria-hidden="true" /> AMD is intentionally stale;
          the simulator will reject any execution that depends on this quote.
        </p>
      </Panel>
      <div className="dashboard-grid dashboard-grid--split">
        <Panel eyebrow="Calendar" title="Recent sessions">
          <div className="session-list">
            {data.sessions.map((session) => (
              <div className="session-list__item" key={session.date}>
                <CalendarClock size={17} aria-hidden="true" />
                <span>
                  <strong>
                    {session.date} · {session.state}
                  </strong>
                  <small>
                    {session.open}–{session.close}
                  </small>
                </span>
                <span className="mono">{session.records} records</span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel eyebrow="Adapters" title="Provider health">
          <div className="source-grid">
            {data.providers.map((provider) => (
              <div className="source-health" key={provider.name}>
                {provider.status === 'healthy' ? (
                  <CheckCircle2 size={16} aria-hidden="true" />
                ) : (
                  <AlertTriangle size={16} aria-hidden="true" />
                )}
                <span>
                  <strong>{provider.name}</strong>
                  <small>
                    {provider.role} · {provider.detail}
                  </small>
                </span>
                <StatusPill
                  tone={provider.status === 'healthy' ? 'positive' : 'warning'}
                >
                  {provider.status}
                </StatusPill>
              </div>
            ))}
          </div>
          <p className="safe-note">
            <Radio size={14} aria-hidden="true" /> Data-only adapters; no broker
            account or order route exists.
          </p>
        </Panel>
      </div>
    </div>
  )
}
