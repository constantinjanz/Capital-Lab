import {
  Archive,
  BrainCircuit,
  CheckCircle2,
  GitCompareArrows,
  Library,
  ShieldCheck,
} from 'lucide-react'

import { CalibrationChart } from '@/components/charts/calibration-chart'
import { DataModeNotice } from '@/components/ui/data-mode-notice'
import { PageHeader } from '@/components/ui/page-header'
import { Panel } from '@/components/ui/panel'
import { StatusPill } from '@/components/ui/status-pill'
import { TableShell } from '@/components/ui/table-shell'
import type { MemoryViewModel } from '@/lib/mock/types'

export function MemoryView({ data }: { data: MemoryViewModel }) {
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Application memory"
        title="Memory & learning"
        description="Immutable decision contexts, point-in-time research, outcome labels, and deterministic strategy promotion gates."
        actions={
          <StatusPill tone="positive" dot>
            Corpus indexed
          </StatusPill>
        }
      />
      <DataModeNotice />
      <div className="dashboard-grid dashboard-grid--split">
        <Panel eyebrow="Knowledge snapshots" title="Corpus versions">
          <div className="corpus-list">
            {data.corpus.map((corpus) => (
              <article key={corpus.version} className="corpus-card">
                <span className="corpus-card__icon">
                  {corpus.state === 'Active' ? (
                    <Library size={18} aria-hidden="true" />
                  ) : (
                    <Archive size={18} aria-hidden="true" />
                  )}
                </span>
                <div>
                  <strong>{corpus.version}</strong>
                  <p>
                    {corpus.documents} documents · {corpus.chunks} chunks
                  </p>
                  <small>Created {corpus.created}</small>
                </div>
                <StatusPill
                  tone={corpus.state === 'Active' ? 'positive' : 'neutral'}
                >
                  {corpus.state}
                </StatusPill>
              </article>
            ))}
          </div>
        </Panel>
        <Panel eyebrow="Retrieval inspection" title="Recent evidence chunks">
          <div className="chunk-list">
            {data.chunks.map((chunk) => (
              <article key={chunk.id} className="chunk-card">
                <div>
                  <code>{chunk.id}</code>
                  <strong>{chunk.score}</strong>
                </div>
                <h3>{chunk.title}</h3>
                <p>{chunk.excerpt}</p>
                <small>{chunk.provenance}</small>
              </article>
            ))}
          </div>
        </Panel>
      </div>

      <Panel eyebrow="Versioned sources" title="Research inventory">
        <TableShell caption="Knowledge sources available to the active experiment">
          <thead>
            <tr>
              <th scope="col">Source</th>
              <th scope="col">Type</th>
              <th scope="col">Quality</th>
              <th scope="col">Version</th>
              <th scope="col">Available from</th>
            </tr>
          </thead>
          <tbody>
            {data.sources.map((source) => (
              <tr key={source.title}>
                <td>
                  <strong>{source.title}</strong>
                </td>
                <td>{source.type}</td>
                <td>
                  <StatusPill
                    tone={source.quality === 'High' ? 'positive' : 'warning'}
                  >
                    {source.quality}
                  </StatusPill>
                </td>
                <td className="mono">{source.version}</td>
                <td>{source.available}</td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      </Panel>

      <div className="dashboard-grid dashboard-grid--split">
        <Panel eyebrow="Measured feedback" title="Outcome labels">
          <TableShell caption="Recent point-in-time decision outcomes">
            <thead>
              <tr>
                <th scope="col">Decision</th>
                <th scope="col">Symbol</th>
                <th scope="col">Horizon</th>
                <th scope="col" className="numeric">
                  Forward return
                </th>
                <th scope="col">Calibration</th>
              </tr>
            </thead>
            <tbody>
              {data.outcomes.map((outcome) => (
                <tr key={`${outcome.decision}-${outcome.horizon}`}>
                  <td>
                    <code>{outcome.decision}</code>
                  </td>
                  <td>
                    <strong>{outcome.symbol}</strong>
                  </td>
                  <td>{outcome.horizon}</td>
                  <td
                    className={`numeric mono ${outcome.return.startsWith('+') ? 'text-positive' : 'text-negative'}`}
                  >
                    {outcome.return}
                  </td>
                  <td>{outcome.calibration}</td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </Panel>
        <Panel eyebrow="Confidence quality" title="Calibration">
          <CalibrationChart rows={data.calibration} />
          <p className="safe-note">
            <ShieldCheck size={14} aria-hidden="true" />
            Observed outcomes stay below stated confidence in every current
            band.
          </p>
        </Panel>
      </div>

      <Panel eyebrow="Hypothesis lifecycle" title="Pattern candidates">
        <div className="hypothesis-grid">
          {data.hypotheses.map((hypothesis) => (
            <article key={hypothesis.name} className="hypothesis-card">
              <div>
                <BrainCircuit size={17} aria-hidden="true" />
                <StatusPill
                  tone={
                    hypothesis.state === 'Eligible'
                      ? 'positive'
                      : hypothesis.state === 'Rejected'
                        ? 'negative'
                        : 'info'
                  }
                >
                  {hypothesis.state}
                </StatusPill>
              </div>
              <h3>{hypothesis.name}</h3>
              <dl>
                <div>
                  <dt>Evidence</dt>
                  <dd>{hypothesis.evidence}</dd>
                </div>
                <div>
                  <dt>Confidence</dt>
                  <dd>{hypothesis.confidence}</dd>
                </div>
                <div>
                  <dt>Next gate</dt>
                  <dd>{hypothesis.nextGate}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </Panel>

      <div className="dashboard-grid dashboard-grid--split">
        <Panel eyebrow="Champion / challenger" title="Strategy versions">
          <div className="strategy-comparison">
            {data.strategies.map((strategy) => (
              <article key={strategy.name}>
                <div>
                  <GitCompareArrows size={17} aria-hidden="true" />
                  <StatusPill
                    tone={strategy.role === 'Champion' ? 'positive' : 'info'}
                  >
                    {strategy.role}
                  </StatusPill>
                </div>
                <h3>{strategy.name}</h3>
                <dl>
                  <div>
                    <dt>Return</dt>
                    <dd className="text-positive">{strategy.return}</dd>
                  </div>
                  <div>
                    <dt>Drawdown</dt>
                    <dd>{strategy.drawdown}</dd>
                  </div>
                  <div>
                    <dt>Samples</dt>
                    <dd>{strategy.samples}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </Panel>
        <Panel eyebrow="Evidence attribution" title="Source performance">
          <div className="source-performance">
            {data.sourcePerformance.map((source) => (
              <div key={source.source}>
                <span>
                  <CheckCircle2 size={15} aria-hidden="true" />
                  <strong>{source.source}</strong>
                </span>
                <span>{source.events} events</span>
                <span>{source.hitRate} hit rate</span>
                <span className="text-positive">{source.avgReturn}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  )
}
