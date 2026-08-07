import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Database,
  FlaskConical,
  LockKeyhole,
  ShieldCheck,
} from 'lucide-react'
import Link from 'next/link'

import { DataModeNotice } from '@/components/ui/data-mode-notice'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { Panel } from '@/components/ui/panel'
import { StatusPill } from '@/components/ui/status-pill'
import type {
  ExperimentDetail,
  ExperimentStatus,
  ExperimentSummary,
  Tone,
} from '@/lib/mock/types'
import type { HostedExperiment } from '@/features/workspace/types'

import { ExperimentControls } from './experiment-controls'
import { NewExperimentButton } from './new-experiment-button'

function statusTone(status: ExperimentStatus): Tone {
  if (status === 'shadow' || status === 'live-paper') return 'positive'
  if (status === 'paused') return 'warning'
  if (status === 'replay') return 'info'
  return 'neutral'
}

export function ExperimentsView({
  experiments,
}: {
  experiments: ExperimentSummary[]
}) {
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Control plane"
        title="Experiments"
        description="Each experiment is one continuous episode with immutable rules after activation."
        actions={<NewExperimentButton />}
      />
      <DataModeNotice compact />
      <div className="experiment-cards">
        {experiments.map((experiment) => (
          <article className="experiment-card" key={experiment.id}>
            <div className="experiment-card__header">
              <span className="experiment-card__icon">
                <FlaskConical size={18} aria-hidden="true" />
              </span>
              <StatusPill tone={statusTone(experiment.status)} dot>
                {experiment.status}
              </StatusPill>
            </div>
            <div>
              <p className="eyebrow">{experiment.version}</p>
              <h2>{experiment.name}</h2>
              <p>{experiment.objective}</p>
            </div>
            <dl className="experiment-card__metrics">
              <div>
                <dt>Current NAV</dt>
                <dd>{experiment.nav}</dd>
              </div>
              <div>
                <dt>Return</dt>
                <dd
                  className={
                    experiment.return.startsWith('+')
                      ? 'text-positive'
                      : experiment.return.startsWith('−')
                        ? 'text-negative'
                        : ''
                  }
                >
                  {experiment.return}
                </dd>
              </div>
              <div>
                <dt>Started</dt>
                <dd>{experiment.startedAt}</dd>
              </div>
            </dl>
            <div className="experiment-card__footer">
              <span>
                <LockKeyhole size={14} aria-hidden="true" />
                {experiment.status === 'draft'
                  ? 'Rules editable'
                  : 'Rules locked'}
              </span>
              <Link
                href={`/experiments/${experiment.id}`}
                className="text-link"
              >
                Inspect <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </div>
          </article>
        ))}
      </div>
      <Panel eyebrow="Lifecycle invariant" title="No reset in place">
        <div className="principle-grid">
          <div>
            <ShieldCheck size={18} aria-hidden="true" />
            <span>
              <strong>Validate before start</strong>
              <small>
                Provider, calendar, simulator, risk and budget gates must pass.
              </small>
            </span>
          </div>
          <div>
            <LockKeyhole size={18} aria-hidden="true" />
            <span>
              <strong>Snapshot every version</strong>
              <small>
                Active experiment rules and prompts cannot mutate silently.
              </small>
            </span>
          </div>
          <div>
            <Clock3 size={18} aria-hidden="true" />
            <span>
              <strong>Preserve the episode</strong>
              <small>Fresh runs receive a new experiment ID and ledger.</small>
            </span>
          </div>
        </div>
      </Panel>
    </div>
  )
}

export function HostedExperimentsView({
  experiments,
  draftOperationId,
}: {
  experiments: HostedExperiment[]
  draftOperationId: string
}) {
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Hosted control plane"
        title="Experiments"
        description="Owner-scoped draft creation, lifecycle, and control state persisted in Supabase."
        actions={
          <NewExperimentButton mode="supabase" operationId={draftOperationId} />
        }
      />
      <DataModeNotice compact mode="supabase" />
      {experiments.length === 0 ? (
        <EmptyState
          icon={Database}
          title="No hosted experiments yet"
          description="The owner workspace is connected. Create a paper-only draft with disabled scheduler and agent controls."
        />
      ) : (
        <div className="experiment-cards">
          {experiments.map((experiment) => (
            <article className="experiment-card" key={experiment.id}>
              <div className="experiment-card__header">
                <span className="experiment-card__icon">
                  <FlaskConical size={18} aria-hidden="true" />
                </span>
                <StatusPill
                  tone={
                    experiment.lifecycleStatus === 'failed'
                      ? 'negative'
                      : experiment.lifecycleStatus === 'paused'
                        ? 'warning'
                        : 'info'
                  }
                  dot
                >
                  {experiment.lifecycleStatus}
                </StatusPill>
              </div>
              <div>
                <p className="eyebrow">
                  {experiment.executionMode?.replace('_', '-') ??
                    'execution mode not selected'}
                </p>
                <h2>{experiment.name}</h2>
                <p>{experiment.objective}</p>
              </div>
              <dl className="experiment-card__metrics">
                <div>
                  <dt>Scheduler</dt>
                  <dd>
                    {experiment.controls
                      ? experiment.controls.schedulerEnabled
                        ? 'Enabled'
                        : 'Off'
                      : 'Not created'}
                  </dd>
                </div>
                <div>
                  <dt>Agent</dt>
                  <dd>
                    {experiment.controls
                      ? experiment.controls.agentEnabled
                        ? 'Enabled'
                        : 'Off'
                      : 'Not created'}
                  </dd>
                </div>
                <div>
                  <dt>Control version</dt>
                  <dd>{experiment.controls ? 'Created' : 'Not created'}</dd>
                </div>
              </dl>
              <div className="experiment-card__footer">
                <span>
                  <LockKeyhole size={14} aria-hidden="true" />
                  {experiment.lifecycleStatus === 'draft'
                    ? 'Name and objective editable'
                    : 'Versioned rules locked'}
                </span>
                <Link
                  href={`/experiments/${experiment.id}`}
                  className="text-link"
                >
                  Inspect <ArrowRight size={14} aria-hidden="true" />
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
      <Panel eyebrow="Write boundary" title="Safe draft defaults">
        <p className="safe-note">
          <ShieldCheck size={14} aria-hidden="true" /> New drafts start with an
          exact EUR 100000.00000000 initial-capital setting. Agent, scheduler,
          and emergency controls remain disabled until later reviewed actions.
        </p>
      </Panel>
    </div>
  )
}

export function ExperimentDetailView({
  experiment,
}: {
  experiment: ExperimentDetail
}) {
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow={experiment.version}
        title={experiment.name}
        description={experiment.description}
        actions={
          <StatusPill tone={statusTone(experiment.status)} dot>
            {experiment.status}
          </StatusPill>
        }
      />
      <DataModeNotice compact />
      <Panel eyebrow="Owner controls" title="Experiment lifecycle">
        <ExperimentControls status={experiment.status} />
      </Panel>
      <div className="dashboard-grid dashboard-grid--primary">
        <Panel
          className="dashboard-grid__wide"
          eyebrow="Versioned rules"
          title="Configuration snapshot"
        >
          <div className="configuration-grid">
            {experiment.configuration.map((item) => (
              <div className="configuration-item" key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <small>{item.detail}</small>
              </div>
            ))}
          </div>
        </Panel>
        <Panel eyebrow="Preflight" title="Safety checks">
          <div className="check-list">
            {experiment.checks.map((check) => (
              <div key={check.label} className="check-item">
                <CheckCircle2
                  size={16}
                  aria-hidden="true"
                  className={
                    check.state === 'pass' ? 'text-positive' : 'text-warning'
                  }
                />
                <span>
                  <strong>{check.label}</strong>
                  <small>{check.detail}</small>
                </span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
      <div className="dashboard-grid dashboard-grid--split">
        <Panel eyebrow="Immutable references" title="Version manifest">
          <dl className="definition-list">
            {experiment.versions.map((version) => (
              <div key={version.label}>
                <dt>{version.label}</dt>
                <dd className="mono">{version.value}</dd>
              </div>
            ))}
          </dl>
        </Panel>
        <Panel eyebrow="Audit trail" title="Recent status events">
          <div className="timeline">
            {experiment.timeline.map((event) => (
              <article
                key={`${event.at}-${event.title}`}
                className="timeline__item"
              >
                <span
                  className={`timeline__marker timeline__marker--${event.tone}`}
                  aria-hidden="true"
                />
                <div>
                  <time>{event.at}</time>
                  <strong>{event.title}</strong>
                  <p>{event.detail}</p>
                </div>
              </article>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  )
}
