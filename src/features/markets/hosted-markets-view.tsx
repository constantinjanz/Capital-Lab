import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Radio,
  ShieldX,
} from 'lucide-react'

import { DataModeNotice } from '@/components/ui/data-mode-notice'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { Panel } from '@/components/ui/panel'
import { StatusPill } from '@/components/ui/status-pill'
import { TableShell } from '@/components/ui/table-shell'
import {
  deriveHostedMarketSessionState,
  type HostedMarketSession,
  type HostedMarketSnapshot,
  type HostedMarketSource,
} from '@/features/markets/hosted-market-snapshot'
import { formatStatus, formatUtc } from '@/lib/formatting'
import type { Tone } from '@/lib/mock/types'

function value(value: string | null | undefined) {
  return value ?? 'Unavailable'
}

function providerState(source: HostedMarketSource): {
  label: string
  tone: Tone
} {
  if (!source.isEnabled) return { label: 'Source disabled', tone: 'neutral' }
  if (!source.health) return { label: 'Not yet observed', tone: 'warning' }
  switch (source.health.status) {
    case 'healthy':
      return { label: 'Last observed healthy', tone: 'positive' }
    case 'degraded':
      return { label: 'Last observed degraded', tone: 'warning' }
    case 'unavailable':
      return { label: 'Last observed unavailable', tone: 'negative' }
    case 'disabled':
      return { label: 'Last observed disabled', tone: 'neutral' }
  }
}

function sessionRowState(
  session: HostedMarketSession,
  decisionAt: string,
): { label: string; tone: Tone } {
  if (session.sessionType === 'closed') {
    return { label: 'Closed', tone: 'neutral' }
  }
  const decisionTime = Date.parse(decisionAt)
  if (session.opensAt && decisionTime < Date.parse(session.opensAt)) {
    return { label: 'Scheduled', tone: 'info' }
  }
  if (
    session.opensAt &&
    session.closesAt &&
    Date.parse(session.opensAt) <= decisionTime &&
    decisionTime < Date.parse(session.closesAt)
  ) {
    return { label: 'Open', tone: 'positive' }
  }
  return { label: 'Closed', tone: 'neutral' }
}

export function HostedMarketsView({
  snapshot,
}: {
  snapshot: HostedMarketSnapshot
}) {
  const sessionState = deriveHostedMarketSessionState(snapshot)
  const sourcesById = new Map(
    snapshot.sources.map((source) => [source.id, source]),
  )
  const quoteRows = snapshot.instruments.flatMap((instrument) =>
    instrument.feeds.map((feed) => ({
      instrument,
      feed,
      source: feed.sourceId ? sourcesById.get(feed.sourceId) : undefined,
    })),
  )

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Persisted market evidence"
        title="Markets"
        description="Owner-scoped quotes, completed one-minute bars, exchange sessions, and provider health at one frozen decision timestamp."
        actions={
          <StatusPill
            tone={sessionState.tone}
            dot={sessionState.state === 'open'}
          >
            {sessionState.label}
          </StatusPill>
        }
      />
      <DataModeNotice mode="supabase" />

      <Panel
        eyebrow="Decision boundary"
        title="Hosted snapshot"
        action={
          <time className="as-of" dateTime={snapshot.decisionAt}>
            {formatUtc(snapshot.decisionAt)}
          </time>
        }
      >
        <dl className="definition-list">
          <div>
            <dt>Session evidence</dt>
            <dd>{sessionState.detail}</dd>
          </div>
          <div>
            <dt>Universe</dt>
            <dd>
              {snapshot.universe
                ? `${snapshot.universe.name} · v${snapshot.universe.version}`
                : 'Not configured'}
            </dd>
          </div>
          <div>
            <dt>Current members</dt>
            <dd>{snapshot.universe?.instrumentIds.length ?? 0}</dd>
          </div>
          <div>
            <dt>Persisted market-data sources</dt>
            <dd>{snapshot.sources.length}</dd>
          </div>
        </dl>
      </Panel>

      <Panel
        eyebrow="Latest configured universe"
        title="Quote and completed-bar evidence"
        action={<span className="as-of">Exact database values · 1m bars</span>}
      >
        {!snapshot.universe ? (
          <EmptyState
            icon={Radio}
            title="No market universe configured"
            description="Create and review a persisted universe before market evidence can be associated with instruments. No fixture symbols are substituted."
          />
        ) : quoteRows.length === 0 ? (
          <EmptyState
            icon={Radio}
            title="This universe has no current members"
            description="The latest universe revision contains no membership valid at the snapshot timestamp."
          />
        ) : (
          <>
            <TableShell caption="Persisted point-in-time quotes and completed bars">
              <thead>
                <tr>
                  <th scope="col">Instrument</th>
                  <th scope="col">Source</th>
                  <th scope="col" className="numeric">
                    Bid
                  </th>
                  <th scope="col" className="numeric">
                    Ask
                  </th>
                  <th scope="col" className="numeric">
                    Bid size
                  </th>
                  <th scope="col" className="numeric">
                    Ask size
                  </th>
                  <th scope="col" className="numeric">
                    Completed 1m close
                  </th>
                  <th scope="col" className="numeric">
                    Bar volume
                  </th>
                  <th scope="col">Evidence available</th>
                </tr>
              </thead>
              <tbody>
                {quoteRows.map(({ instrument, feed, source }) => (
                  <tr
                    key={`${instrument.id}:${feed.sourceId ?? 'unconfigured'}`}
                  >
                    <th scope="row">
                      <div className="symbol-cell">
                        <strong>{instrument.symbol}</strong>
                        <span>
                          {instrument.name} · {instrument.exchange.mic}
                        </span>
                      </div>
                    </th>
                    <td>
                      <div className="symbol-cell">
                        <strong>{source?.name ?? 'Not configured'}</strong>
                        <span>
                          {source
                            ? `${source.code}${source.isMock ? ' · synthetic' : ''}`
                            : 'No persisted market-data source'}
                        </span>
                      </div>
                    </td>
                    <td className="numeric mono">
                      {value(feed.quote?.bidPrice)}
                    </td>
                    <td className="numeric mono">
                      {value(feed.quote?.askPrice)}
                    </td>
                    <td className="numeric mono">
                      {value(feed.quote?.bidSize)}
                    </td>
                    <td className="numeric mono">
                      {value(feed.quote?.askSize)}
                    </td>
                    <td className="numeric mono">
                      {value(feed.bar?.closePrice)}
                    </td>
                    <td className="numeric mono">{value(feed.bar?.volume)}</td>
                    <td>
                      <div className="symbol-cell">
                        <strong>
                          {feed.quote ? (
                            <time dateTime={feed.quote.availableAt}>
                              {formatUtc(feed.quote.availableAt)}
                            </time>
                          ) : (
                            'No quote'
                          )}
                        </strong>
                        <span>
                          {feed.bar ? (
                            <time dateTime={feed.bar.availableAt}>
                              Bar · {formatUtc(feed.bar.availableAt)}
                            </time>
                          ) : (
                            'No completed bar'
                          )}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
            <p className="safe-note safe-note--warning">
              <AlertTriangle size={14} aria-hidden="true" /> Missing values are
              unavailable, never zero. No freshness threshold or last-trade
              price is inferred from persisted bid, ask, or bar data.
            </p>
          </>
        )}
      </Panel>

      <div className="dashboard-grid dashboard-grid--split">
        <Panel eyebrow="Calendar evidence" title="Recent sessions">
          {snapshot.sessions.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title="No session records available"
              description="Market-open status remains unavailable until an eligible persisted calendar row exists."
            />
          ) : (
            <div className="session-list">
              {snapshot.sessions.map((session) => {
                const state = sessionRowState(session, snapshot.decisionAt)
                return (
                  <div className="session-list__item" key={session.id}>
                    <CalendarClock size={17} aria-hidden="true" />
                    <span>
                      <strong>
                        {session.sessionDate} · {session.exchangeMic} ·{' '}
                        {formatStatus(session.sessionType)}
                      </strong>
                      <small>
                        {session.opensAt && session.closesAt
                          ? `${formatUtc(session.opensAt)}–${formatUtc(session.closesAt)}`
                          : 'No trading window'}{' '}
                        · {session.calendarSourceName ?? 'Source unavailable'}
                      </small>
                    </span>
                    <StatusPill tone={state.tone}>{state.label}</StatusPill>
                  </div>
                )
              })}
            </div>
          )}
        </Panel>

        <Panel eyebrow="Persisted observations" title="Provider health">
          {snapshot.sources.length === 0 ? (
            <EmptyState
              icon={Clock3}
              title="No market-data source configured"
              description="The database has no persisted market-data provider to monitor. No external provider is contacted by this page."
            />
          ) : (
            <div className="source-grid">
              {snapshot.sources.map((source) => {
                const state = providerState(source)
                return (
                  <div className="source-health" key={source.id}>
                    {state.tone === 'positive' ? (
                      <CheckCircle2
                        className={`source-health__icon source-health__icon--${state.tone}`}
                        size={16}
                        aria-hidden="true"
                      />
                    ) : (
                      <AlertTriangle
                        className={`source-health__icon source-health__icon--${state.tone}`}
                        size={16}
                        aria-hidden="true"
                      />
                    )}
                    <span>
                      <strong>
                        {source.name}
                        {source.isMock ? ' · Synthetic' : ''}
                      </strong>
                      <small>
                        {source.provider} ·{' '}
                        {source.health
                          ? `checked ${formatUtc(source.health.checkedAt)}`
                          : 'no health observation'}
                      </small>
                    </span>
                    <StatusPill tone={state.tone}>{state.label}</StatusPill>
                  </div>
                )
              })}
            </div>
          )}
          <p className="safe-note">
            <ShieldX size={14} aria-hidden="true" /> Read-only market evidence.
            This page cannot place orders, contact a broker, or activate an
            ingestion adapter.
          </p>
        </Panel>
      </div>
    </div>
  )
}
