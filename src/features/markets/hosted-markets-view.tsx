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
import { MARKET_FEATURE_VERSION } from '@/domain/market-data/features'
import { hasReviewedHostedMarketManifest } from '@/features/markets/hosted-market-configuration-status'
import { type HostedMarketIngestionReadiness } from '@/features/markets/hosted-market-ingestion'
import { HostedMarketIngestionControl } from '@/features/markets/hosted-market-ingestion-control'
import { type HostedOfficialCalendarState } from '@/features/markets/hosted-official-calendar'
import { HostedOfficialCalendarControl } from '@/features/markets/hosted-official-calendar-control'
import {
  deriveHostedMarketSessionState,
  type HostedMarketSession,
  type HostedMarketSnapshot,
  type HostedMarketSource,
} from '@/features/markets/hosted-market-snapshot'
import { HostedMarketSetupControl } from '@/features/markets/hosted-market-setup-control'
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
  configurationOperationId,
  calendarConfigurationOperationId,
  officialCalendarState,
  sourceLifecycleOperationId,
  ingestionOperationId,
  ingestionReadiness,
  ingestionWindow,
}: {
  snapshot: HostedMarketSnapshot
  configurationOperationId: string
  calendarConfigurationOperationId: string
  officialCalendarState: HostedOfficialCalendarState
  sourceLifecycleOperationId: string
  ingestionOperationId: string
  ingestionReadiness: HostedMarketIngestionReadiness
  ingestionWindow: {
    windowStart: string
    windowEnd: string
  }
}) {
  const sessionState = deriveHostedMarketSessionState(snapshot)
  const manifestConfigured = hasReviewedHostedMarketManifest(snapshot)
  const sourcesById = new Map(
    snapshot.sources.map((source) => [source.id, source]),
  )
  const alpacaIexSource = snapshot.sources.find(
    (source) =>
      source.code === 'alpaca_iex' &&
      source.provider === 'alpaca' &&
      source.sourceType === 'market_data' &&
      !source.isMock,
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
        {!manifestConfigured ? (
          <>
            <EmptyState
              icon={Radio}
              title={
                snapshot.universe
                  ? 'Reviewed market manifest not configured'
                  : 'No market universe configured'
              }
              description={
                snapshot.universe
                  ? 'The current persisted universe is not the reviewed five-instrument hosted manifest. Save the fixed manifest before using this market evidence view.'
                  : 'Create and review a persisted universe before market evidence can be associated with instruments. No fixture symbols are substituted.'
              }
            />
            <HostedMarketSetupControl operationId={configurationOperationId} />
          </>
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

      {manifestConfigured ? (
        <Panel
          eyebrow="Versioned deterministic code"
          title="Technical feature vector"
          action={<span className="as-of">{MARKET_FEATURE_VERSION}</span>}
        >
          {quoteRows.length === 0 ? (
            <EmptyState
              icon={Radio}
              title="No configured feeds available"
              description="Feature values remain unavailable until the reviewed universe has a persisted market-data feed."
            />
          ) : (
            <>
              <TableShell caption="Point-in-time deterministic market features">
                <thead>
                  <tr>
                    <th scope="col">Instrument / source</th>
                    <th scope="col" className="numeric">
                      Spread
                    </th>
                    <th scope="col" className="numeric">
                      Spread bps
                    </th>
                    <th scope="col" className="numeric">
                      Return 1m
                    </th>
                    <th scope="col" className="numeric">
                      Return 5m
                    </th>
                    <th scope="col" className="numeric">
                      Relative volume 20m
                    </th>
                    <th scope="col" className="numeric">
                      Realized vol 5m
                    </th>
                    <th scope="col" className="numeric">
                      Distance SMA5
                    </th>
                    <th scope="col" className="numeric">
                      Distance TP-VWAP20
                    </th>
                    <th scope="col" className="numeric">
                      Contiguous bars
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {quoteRows.map(({ instrument, feed, source }) => (
                    <tr
                      key={`feature:${instrument.id}:${feed.sourceId ?? 'unconfigured'}`}
                    >
                      <th scope="row">
                        <div className="symbol-cell">
                          <strong>{instrument.symbol}</strong>
                          <span>{source?.name ?? 'Not configured'}</span>
                        </div>
                      </th>
                      <td className="numeric mono">
                        {value(feed.features.spreadAbsolute)}
                      </td>
                      <td className="numeric mono">
                        {value(feed.features.spreadBps)}
                      </td>
                      <td className="numeric mono">
                        {value(feed.features.return1m)}
                      </td>
                      <td className="numeric mono">
                        {value(feed.features.return5m)}
                      </td>
                      <td className="numeric mono">
                        {value(feed.features.relativeVolume20)}
                      </td>
                      <td className="numeric mono">
                        {value(feed.features.realizedVolatility5m)}
                      </td>
                      <td className="numeric mono">
                        {value(feed.features.distanceFromSma5)}
                      </td>
                      <td className="numeric mono">
                        {value(feed.features.distanceFromTypicalPriceVwap20)}
                      </td>
                      <td className="numeric mono">
                        {feed.features.contiguousBarCount}/
                        {feed.features.observedBarCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
              <p className="safe-note">
                Returns and distances are decimal ratios; realized volatility is
                the non-annualized root-sum-square of five contiguous one-minute
                returns. TP-VWAP20 is the volume-weighted typical price derived
                from persisted OHLCV bars. A missing minute or insufficient
                exact history makes the affected feature unavailable.
              </p>
            </>
          )}
        </Panel>
      ) : null}

      {manifestConfigured ? (
        <Panel
          eyebrow="Explicit data-only operation"
          title="Hosted Alpaca IEX ingestion"
          action={<span className="as-of">Manual owner trigger only</span>}
        >
          <HostedMarketIngestionControl
            lifecycleOperationId={sourceLifecycleOperationId}
            ingestionOperationId={ingestionOperationId}
            readiness={ingestionReadiness}
            sourceEnabled={alpacaIexSource?.isEnabled === true}
            windowStart={ingestionWindow.windowStart}
            windowEnd={ingestionWindow.windowEnd}
          />
        </Panel>
      ) : null}

      <div className="dashboard-grid dashboard-grid--split">
        <Panel eyebrow="Calendar evidence" title="Recent sessions">
          <HostedOfficialCalendarControl
            operationId={calendarConfigurationOperationId}
            state={officialCalendarState}
          />
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
            <ShieldX size={14} aria-hidden="true" /> Market-data controls cannot
            place orders, link a brokerage account, or enable AI or automated
            scheduling.
          </p>
        </Panel>
      </div>
    </div>
  )
}
