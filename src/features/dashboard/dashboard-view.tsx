import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleDollarSign,
  Radio,
  ShieldCheck,
} from 'lucide-react'
import Link from 'next/link'

import { EquityChart } from '@/components/charts/equity-chart'
import { DataModeNotice } from '@/components/ui/data-mode-notice'
import { MetricCard } from '@/components/ui/metric-card'
import { PageHeader } from '@/components/ui/page-header'
import { Panel } from '@/components/ui/panel'
import { ProgressMeter } from '@/components/ui/progress-meter'
import { StatusPill } from '@/components/ui/status-pill'
import { TableShell } from '@/components/ui/table-shell'
import type { DashboardViewModel, Tone } from '@/lib/mock/types'

function decisionTone(status: 'accepted' | 'rejected' | 'abstained'): Tone {
  if (status === 'accepted') return 'positive'
  if (status === 'rejected') return 'warning'
  return 'neutral'
}

export function DashboardView({ data }: { data: DashboardViewModel }) {
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Experiment overview"
        title="Research dashboard"
        description="Point-in-time portfolio, risk, evidence, and system health for Northstar Event Lab."
        actions={
          <Link
            className="button button--secondary"
            href="/experiments/northstar-event-lab"
          >
            Inspect experiment <ArrowRight size={15} aria-hidden="true" />
          </Link>
        }
      />
      <DataModeNotice />

      <section className="metric-grid" aria-label="Portfolio summary">
        {data.metrics.map((metric) => (
          <MetricCard key={metric.label} metric={metric} />
        ))}
      </section>

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel
          className="dashboard-grid__wide"
          eyebrow="Performance"
          title="Equity curve"
          action={
            <span className="as-of">14 sessions · exact values below</span>
          }
        >
          <EquityChart points={data.equityCurve} />
          <div className="chart-summary">
            <span>
              <small>Current NAV</small>
              <strong>€103,842.66</strong>
            </span>
            <span>
              <small>Benchmark value</small>
              <strong>€102,110.00</strong>
            </span>
            <span>
              <small>Relative return</small>
              <strong className="text-positive">+1.73%</strong>
            </span>
          </div>
        </Panel>

        <Panel eyebrow="Deterministic guardrails" title="Risk state">
          <div className="risk-heading">
            <span className="risk-heading__icon">
              <ShieldCheck size={19} aria-hidden="true" />
            </span>
            <span>
              <strong>Within limits</strong>
              <small>61% maximum utilization</small>
            </span>
          </div>
          <div className="meter-list">
            {data.risk.items.map((item) => (
              <div className="meter-item" key={item.label}>
                <div>
                  <span>{item.label}</span>
                  <strong>
                    {item.value} <small>/ {item.limit}</small>
                  </strong>
                </div>
                <ProgressMeter
                  value={item.utilization}
                  label={item.label}
                  tone={item.utilization > 80 ? 'warning' : 'info'}
                />
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel
        eyebrow="Current book"
        title="Top positions"
        action={<span className="as-of">Reconciled at 14:45 UTC</span>}
      >
        <TableShell caption="Open paper positions">
          <thead>
            <tr>
              <th scope="col">Instrument</th>
              <th scope="col">Side</th>
              <th scope="col" className="numeric">
                Quantity
              </th>
              <th scope="col" className="numeric">
                Market value
              </th>
              <th scope="col" className="numeric">
                Weight
              </th>
              <th scope="col" className="numeric">
                Unrealized P&amp;L
              </th>
            </tr>
          </thead>
          <tbody>
            {data.positions.map((position) => (
              <tr key={position.symbol}>
                <td>
                  <div className="symbol-cell">
                    <strong>{position.symbol}</strong>
                    <span>{position.name}</span>
                  </div>
                </td>
                <td>
                  <StatusPill
                    tone={position.side === 'Long' ? 'info' : 'warning'}
                  >
                    {position.side}
                  </StatusPill>
                </td>
                <td className="numeric mono">{position.quantity}</td>
                <td className="numeric mono">{position.marketValue}</td>
                <td className="numeric mono">{position.weight}</td>
                <td className={`numeric mono text-${position.pnlTone}`}>
                  {position.pnl}
                </td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      </Panel>

      <div className="dashboard-grid dashboard-grid--triple">
        <Panel
          eyebrow="Agent"
          title="Recent decisions"
          action={
            <Link className="text-link" href="/agent">
              Open console
            </Link>
          }
        >
          <div className="activity-list">
            {data.decisions.map((decision) => (
              <article className="activity-item" key={decision.id}>
                <div className="activity-item__top">
                  <strong>
                    {decision.symbol} · {decision.action}
                  </strong>
                  <span>{decision.at}</span>
                </div>
                <p>{decision.summary}</p>
                <div>
                  <StatusPill tone={decisionTone(decision.status)}>
                    {decision.status}
                  </StatusPill>
                  <span className="meta-text">
                    {decision.model} · {decision.confidence}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </Panel>

        <Panel eyebrow="Simulator" title="Recent fills">
          <div className="activity-list">
            {data.fills.map((fill) => (
              <article className="activity-item" key={fill.id}>
                <div className="activity-item__top">
                  <strong>
                    {fill.symbol} · {fill.side}
                  </strong>
                  <span>{fill.at}</span>
                </div>
                <p>
                  <span className="mono">{fill.quantity}</span> shares at{' '}
                  <span className="mono">{fill.price}</span>
                </p>
                <StatusPill
                  tone={fill.status === 'filled' ? 'positive' : 'warning'}
                >
                  {fill.status}
                </StatusPill>
              </article>
            ))}
          </div>
        </Panel>

        <Panel
          eyebrow="Event pipeline"
          title="Relevant events"
          action={
            <Link className="text-link" href="/events">
              View feed
            </Link>
          }
        >
          <div className="activity-list">
            {data.events.slice(0, 3).map((event) => (
              <article className="activity-item" key={event.id}>
                <div className="activity-item__top">
                  <strong>{event.category}</strong>
                  <span>{event.at}</span>
                </div>
                <p>{event.title}</p>
                <div>
                  <StatusPill
                    tone={event.relevance > 80 ? 'positive' : 'neutral'}
                  >
                    {event.relevance}% relevant
                  </StatusPill>
                  <span className="meta-text">{event.symbols.join(' · ')}</span>
                </div>
              </article>
            ))}
          </div>
        </Panel>
      </div>

      <div className="dashboard-grid dashboard-grid--health">
        <Panel eyebrow="OpenAI cost guard" title="API budget">
          <div className="health-card__lead">
            <CircleDollarSign size={19} aria-hidden="true" />
            <div>
              <strong>{data.budget.label}</strong>
              <span>{data.budget.detail}</span>
            </div>
          </div>
          <ProgressMeter
            value={data.budget.used}
            label="Daily API budget"
            tone="info"
          />
          <div className="thresholds">
            <span>70% warn</span>
            <span>90% critical</span>
            <span>100% pause</span>
          </div>
        </Panel>
        <Panel eyebrow="Ingestion" title="Source health">
          <div className="source-grid">
            {data.sources.map((source) => (
              <div className="source-health" key={source.name}>
                {source.status === 'healthy' ? (
                  <CheckCircle2 size={16} aria-hidden="true" />
                ) : (
                  <AlertTriangle size={16} aria-hidden="true" />
                )}
                <span>
                  <strong>{source.name}</strong>
                  <small>{source.freshness} old</small>
                </span>
                <StatusPill
                  tone={source.status === 'healthy' ? 'positive' : 'warning'}
                >
                  {source.status}
                </StatusPill>
              </div>
            ))}
          </div>
          <p className="safe-note">
            <Radio size={14} aria-hidden="true" /> Stale AMD data blocks
            execution but not ingestion.
          </p>
        </Panel>
      </div>
    </div>
  )
}
