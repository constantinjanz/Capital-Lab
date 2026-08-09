import {
  AlertTriangle,
  CalendarDays,
  CircleDollarSign,
  Gauge,
  ShieldCheck,
} from 'lucide-react'

import { DataModeNotice } from '@/components/ui/data-mode-notice'
import { PageHeader } from '@/components/ui/page-header'
import { Panel } from '@/components/ui/panel'
import { ProgressMeter } from '@/components/ui/progress-meter'
import { StatusPill } from '@/components/ui/status-pill'
import { TableShell } from '@/components/ui/table-shell'
import type { CostViewModel } from '@/lib/mock/types'
import type { HostedBudgetStatus } from '@/lib/supabase/budget-status-read-repository'
import type { HostedStorageStatus } from '@/lib/supabase/storage-status-read-repository'

export function CostsView({
  data,
  storage,
  budget,
}: {
  data: CostViewModel
  storage: HostedStorageStatus
  budget: HostedBudgetStatus
}) {
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Hard budget guard"
        title="AI costs"
        description="Reserved, settled, unknown, skipped, and projected spend across every model-assisted operation."
        actions={
          <StatusPill tone="positive" dot>
            Within all limits
          </StatusPill>
        }
      />
      <DataModeNotice compact />
      <section
        className="budget-periods"
        aria-label="Budget period utilization"
      >
        {data.periods.map((period) => (
          <article className="budget-card" key={period.label}>
            <div>
              <span>{period.label}</span>
              <StatusPill tone={period.state}>
                {period.utilization}% reserved
              </StatusPill>
            </div>
            <strong>
              {period.spent} <small>settled</small>
            </strong>
            <ProgressMeter
              value={period.utilization}
              label={`${period.label} budget`}
              tone={period.utilization > 70 ? 'warning' : 'info'}
            />
            <p>
              {period.reserved} reserved · {period.limit} hard limit
            </p>
          </article>
        ))}
      </section>
      <section
        className="metric-grid metric-grid--four"
        aria-label="Cost accounting states"
      >
        {data.states.map((state) => (
          <article className="metric-card" key={state.label}>
            <p>{state.label}</p>
            <strong className={`metric-card__value text-${state.tone}`}>
              {state.value}
            </strong>
            <span className="metric-card__detail">{state.detail}</span>
          </article>
        ))}
      </section>
      <div className="dashboard-grid dashboard-grid--split">
        <Panel eyebrow="Attribution" title="Cost by model">
          <div className="cost-bars">
            {data.byModel.map((model) => (
              <div className="cost-bar" key={model.model}>
                <div>
                  <span>
                    <strong>{model.model}</strong>
                    <small>
                      {model.calls} calls · {model.tokens} tokens
                    </small>
                  </span>
                  <strong>{model.spend}</strong>
                </div>
                <ProgressMeter
                  value={model.share}
                  label={`${model.model} cost share`}
                  tone="info"
                />
              </div>
            ))}
          </div>
        </Panel>
        <Panel eyebrow="Routing efficiency" title="Cost by run type">
          <TableShell caption="AI cost by run type">
            <thead>
              <tr>
                <th scope="col">Run type</th>
                <th scope="col" className="numeric">
                  Runs
                </th>
                <th scope="col" className="numeric">
                  Spend
                </th>
                <th scope="col" className="numeric">
                  Average
                </th>
              </tr>
            </thead>
            <tbody>
              {data.byRun.map((run) => (
                <tr key={run.type}>
                  <td>
                    <strong>{run.type}</strong>
                  </td>
                  <td className="numeric mono">{run.runs}</td>
                  <td className="numeric mono">{run.spend}</td>
                  <td className="numeric mono">{run.avg}</td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </Panel>
      </div>
      <div className="dashboard-grid dashboard-grid--health">
        <Panel eyebrow="Forecast" title="Projected runway">
          <div className="runway">
            <span>
              <CalendarDays size={20} aria-hidden="true" />
            </span>
            <div>
              <strong>{data.runway.tradingDays}</strong>
              <p>{data.runway.months} at current usage</p>
            </div>
          </div>
          <p className="muted-copy">{data.runway.basis}</p>
          <div className="web-budget">
            <Gauge size={16} aria-hidden="true" />
            <span>
              <strong>Controlled web research</strong>
              <small>
                {data.webSearch.today} today · {data.webSearch.month} month ·{' '}
                {data.webSearch.limit}
              </small>
            </span>
          </div>
        </Panel>
        <Panel eyebrow="Automatic response" title="Budget thresholds">
          <div className="threshold-list">
            {data.alerts.map((alert) => (
              <div key={alert.threshold}>
                <span className="threshold-list__value">{alert.threshold}</span>
                <span>
                  <strong>{alert.state}</strong>
                  <small>{alert.detail}</small>
                </span>
                {alert.threshold === '100%' ? (
                  <AlertTriangle size={16} aria-hidden="true" />
                ) : (
                  <ShieldCheck size={16} aria-hidden="true" />
                )}
              </div>
            ))}
          </div>
          <p className="safe-note">
            <CircleDollarSign size={14} aria-hidden="true" /> Unknown usage is
            held conservatively until reconciliation; no recursive paid retry.
          </p>
        </Panel>
      </div>
      <Panel eyebrow="Supabase Free guard" title="Database storage">
        {!storage.available ? (
          <p className="muted-copy">
            Storage monitoring is unavailable until the reviewed audit migration
            is applied and the AI-free monitor captures its first snapshot.
          </p>
        ) : (
          <div className="dashboard-grid dashboard-grid--split">
            <div className="threshold-list">
              <div>
                <span className="threshold-list__value">
                  {storage.utilizationPercent}%
                </span>
                <span>
                  <strong>{storage.thresholdState}</strong>
                  <small>
                    {storage.databaseBytes} / {storage.limitBytes} bytes
                  </small>
                </span>
                <ShieldCheck size={16} aria-hidden="true" />
              </div>
              <div>
                <span className="threshold-list__value">7d</span>
                <span>
                  <strong>{storage.growth7Bytes} bytes</strong>
                  <small>30d growth: {storage.growth30Bytes} bytes</small>
                </span>
              </div>
              <div>
                <span className="threshold-list__value">90%</span>
                <span>
                  <strong>
                    {storage.forecastDays.pause_90 === null
                      ? 'Forecast pending'
                      : `${storage.forecastDays.pause_90} days`}
                  </strong>
                  <small>
                    Last cleanup: {storage.lastCleanupAt ?? 'not yet run'} (
                    {storage.lastCleanupCount} compacted)
                  </small>
                </span>
              </div>
            </div>
            <TableShell caption="Largest database relations">
              <thead>
                <tr>
                  <th scope="col">Relation</th>
                  <th scope="col" className="numeric">
                    Bytes
                  </th>
                </tr>
              </thead>
              <tbody>
                {storage.largestRelations.slice(0, 8).map((relation) => (
                  <tr key={`${relation.schema}.${relation.relation}`}>
                    <td className="mono">
                      {relation.schema}.{relation.relation}
                    </td>
                    <td className="numeric mono">{relation.totalBytes}</td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          </div>
        )}
      </Panel>
      <Panel eyebrow="Durable budget evidence" title="Hosted threshold alerts">
        {!budget.available ? (
          <p className="muted-copy">
            Hosted budget alerts are unavailable until the reviewed migration is
            applied. Paid calls remain blocked by default.
          </p>
        ) : (
          <>
            <p className="muted-copy">
              Day ${budget.limits.tradingDaySoft} soft / $
              {budget.limits.tradingDayHard} hard · month $
              {budget.limits.monthlySoft} soft / ${budget.limits.monthlyHard}{' '}
              hard · experiment ${budget.limits.experimentHard} · lifetime $
              {budget.limits.lifetimeHard}
            </p>
            <TableShell caption="Persistent deduplicated budget alerts">
              <thead>
                <tr>
                  <th scope="col">Scope</th>
                  <th scope="col">Threshold</th>
                  <th scope="col" className="numeric">
                    Used / limit
                  </th>
                  <th scope="col">Emitted</th>
                </tr>
              </thead>
              <tbody>
                {budget.alerts.length === 0 ? (
                  <tr>
                    <td colSpan={4}>No 70/90/100% alert has been emitted.</td>
                  </tr>
                ) : (
                  budget.alerts.map((alert) => (
                    <tr
                      key={`${alert.scopeKind}:${alert.scopeKey}:${alert.thresholdPercent}`}
                    >
                      <td>{alert.scopeKind}</td>
                      <td>{alert.thresholdPercent}%</td>
                      <td className="numeric mono">
                        ${alert.usedAmount} / ${alert.limitAmount}
                      </td>
                      <td>{alert.emittedAt}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </TableShell>
          </>
        )}
      </Panel>
    </div>
  )
}
