import {
  AlertTriangle,
  ArrowDown,
  Bot,
  Brain,
  CheckCircle2,
  Clock3,
  Cpu,
  ShieldX,
  Wrench,
} from 'lucide-react'

import { DataModeNotice } from '@/components/ui/data-mode-notice'
import { PageHeader } from '@/components/ui/page-header'
import { Panel } from '@/components/ui/panel'
import { ProgressMeter } from '@/components/ui/progress-meter'
import { StatusPill } from '@/components/ui/status-pill'
import type { AgentStage, AgentViewModel, Tone } from '@/lib/mock/types'

function stageTone(state: AgentStage['state']): Tone {
  if (state === 'complete') return 'positive'
  if (state === 'rejected') return 'warning'
  return 'neutral'
}

export function AgentView({ data }: { data: AgentViewModel }) {
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="AI observability"
        title="Agent console"
        description="Structured decisions, evidence, tool calls, routing, cost, and deterministic portfolio impact—never hidden chain-of-thought."
        actions={
          <StatusPill tone="info" dot>
            Shadow mode
          </StatusPill>
        }
      />
      <DataModeNotice />
      <div className="agent-layout">
        <Panel
          className="agent-column agent-column--feed"
          eyebrow="Luna input"
          title="Ranked signals"
          compact
        >
          <div className="candidate-list">
            {data.candidates.map((candidate, index) => (
              <article
                key={candidate.id}
                className={
                  index === 0
                    ? 'candidate-card candidate-card--active'
                    : 'candidate-card'
                }
              >
                <div className="candidate-card__rank">
                  {String(index + 1).padStart(2, '0')}
                </div>
                <div>
                  <div className="event-card__meta">
                    <span>{candidate.category}</span>
                    <time>{candidate.at}</time>
                  </div>
                  <h3>{candidate.title}</h3>
                  <p>{candidate.signal}</p>
                  <div className="candidate-card__footer">
                    <span>{candidate.symbols.join(' · ')}</span>
                    <strong>{candidate.relevance}%</strong>
                  </div>
                </div>
              </article>
            ))}
          </div>
          <div className="queue-note">
            <Clock3 size={15} aria-hidden="true" />
            <span>
              <strong>Next mock cycle</strong>15:00 UTC · no paid call
            </span>
          </div>
        </Panel>

        <Panel
          className="agent-column agent-column--timeline"
          eyebrow={data.run.id}
          title="Structured run timeline"
          action={<StatusPill tone="warning">Rejected</StatusPill>}
          compact
        >
          <div className="run-summary">
            <span>
              <small>Trigger</small>
              <strong>{data.run.trigger}</strong>
            </span>
            <span>
              <small>Duration</small>
              <strong>{data.run.duration}</strong>
            </span>
          </div>
          <ol className="agent-timeline">
            {data.run.stages.map((stage, index) => (
              <li key={stage.name} className="agent-stage">
                <div
                  className={`agent-stage__icon agent-stage__icon--${stage.state}`}
                >
                  {stage.name === 'Risk engine' ? (
                    <ShieldX size={17} aria-hidden="true" />
                  ) : stage.name === 'Sol' ? (
                    <Brain size={17} aria-hidden="true" />
                  ) : (
                    <Bot size={17} aria-hidden="true" />
                  )}
                </div>
                <div className="agent-stage__body">
                  <div className="agent-stage__heading">
                    <div>
                      <h3>{stage.name}</h3>
                      <span>{stage.at}</span>
                    </div>
                    <StatusPill tone={stageTone(stage.state)}>
                      {stage.state}
                    </StatusPill>
                  </div>
                  <p>{stage.summary}</p>
                  <dl className="stage-stats">
                    <div>
                      <dt>Model</dt>
                      <dd>{stage.model}</dd>
                    </div>
                    <div>
                      <dt>Tokens</dt>
                      <dd>{stage.tokens}</dd>
                    </div>
                    <div>
                      <dt>Cost</dt>
                      <dd>{stage.cost}</dd>
                    </div>
                    <div>
                      <dt>Latency</dt>
                      <dd>{stage.latency}</dd>
                    </div>
                  </dl>
                  {stage.evidence.length ? (
                    <div className="tag-row">
                      <span>
                        <Cpu size={13} aria-hidden="true" />
                        Evidence
                      </span>
                      {stage.evidence.map((item) => (
                        <code key={item}>{item}</code>
                      ))}
                    </div>
                  ) : null}
                  {stage.tools.length ? (
                    <div className="tag-row">
                      <span>
                        <Wrench size={13} aria-hidden="true" />
                        Tools
                      </span>
                      {stage.tools.map((item) => (
                        <code key={item}>{item}</code>
                      ))}
                    </div>
                  ) : null}
                </div>
                {index < data.run.stages.length - 1 ? (
                  <ArrowDown
                    className="agent-stage__connector"
                    size={15}
                    aria-hidden="true"
                  />
                ) : null}
              </li>
            ))}
          </ol>
          <div className="rationale-block">
            <p className="eyebrow">Concise decision rationale</p>
            <p>{data.run.rationale}</p>
            <p className="safe-note">
              <CheckCircle2 size={14} aria-hidden="true" />
              Facts, inference, uncertainty and evidence are stored; private
              reasoning is not.
            </p>
          </div>
          <div className="scenario-grid">
            {data.run.scenarios.map((scenario) => (
              <article key={scenario.name}>
                <span>
                  {scenario.name}
                  <strong>{scenario.probability}</strong>
                </span>
                <p>{scenario.summary}</p>
              </article>
            ))}
          </div>
        </Panel>

        <div className="agent-column agent-column--impact">
          <Panel eyebrow="Deterministic result" title="Proposal" compact>
            <div className="proposal-state">
              <AlertTriangle size={19} aria-hidden="true" />
              <div>
                <strong>{data.run.proposal.result}</strong>
                <span>No simulated order or fill created</span>
              </div>
            </div>
            <dl className="definition-list">
              <div>
                <dt>Action</dt>
                <dd>{data.run.proposal.action}</dd>
              </div>
              <div>
                <dt>Instrument</dt>
                <dd>{data.run.proposal.symbol}</dd>
              </div>
              <div>
                <dt>Exposure intent</dt>
                <dd>{data.run.proposal.exposure}</dd>
              </div>
              <div>
                <dt>Horizon</dt>
                <dd>{data.run.proposal.horizon}</dd>
              </div>
            </dl>
            <div className="rejection-list">
              <p className="eyebrow">Machine-readable reasons</p>
              {data.run.rejectionReasons.map((reason) => (
                <code key={reason}>{reason}</code>
              ))}
            </div>
          </Panel>
          <Panel eyebrow="What-if snapshot" title="Portfolio impact" compact>
            <div className="impact-columns">
              <dl>
                <p>Before</p>
                {data.impact.before.map((item) => (
                  <div key={item.label}>
                    <dt>{item.label}</dt>
                    <dd>{item.value}</dd>
                  </div>
                ))}
              </dl>
              <dl>
                <p>Proposed</p>
                {data.impact.after.map((item) => (
                  <div key={item.label}>
                    <dt>{item.label}</dt>
                    <dd>{item.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="meter-list">
              {data.impact.constraints.map((constraint) => (
                <div className="meter-item" key={constraint.label}>
                  <div>
                    <span>{constraint.label}</span>
                    <strong
                      className={
                        constraint.state === 'warning' ? 'text-warning' : ''
                      }
                    >
                      {constraint.utilization}%
                    </strong>
                  </div>
                  <ProgressMeter
                    value={constraint.utilization}
                    label={constraint.label}
                    tone={constraint.state === 'warning' ? 'warning' : 'info'}
                  />
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}
