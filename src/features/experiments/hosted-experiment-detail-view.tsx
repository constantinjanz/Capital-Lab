import { Database, LockKeyhole, ShieldCheck } from 'lucide-react'

import { DataModeNotice } from '@/components/ui/data-mode-notice'
import { PageHeader } from '@/components/ui/page-header'
import { Panel } from '@/components/ui/panel'
import { StatusPill } from '@/components/ui/status-pill'
import { HostedDraftEditor } from '@/features/experiments/hosted-draft-editor'
import type { HostedExperimentDetail } from '@/features/experiments/hosted-experiment-detail'
import { isHostedDraftMetadataEditable } from '@/features/experiments/hosted-experiment-detail'
import { formatStatus, formatUtc } from '@/lib/formatting'
import type { Tone } from '@/lib/mock/types'

function statusTone(status: HostedExperimentDetail['lifecycleStatus']): Tone {
  if (status === 'active') return 'positive'
  if (status === 'paused') return 'warning'
  if (status === 'failed') return 'negative'
  return 'info'
}

function formatOptionalDate(value: string | null): string {
  return value ? formatUtc(value) : 'Not set'
}

function enabledLabel(value: boolean): string {
  return value ? 'Enabled' : 'Off'
}

export function HostedExperimentDetailView({
  experiment,
  draftOperationId,
}: {
  experiment: HostedExperimentDetail
  draftOperationId: string
}) {
  const lockedVersion = experiment.lockedVersion
  const canEditDraft = isHostedDraftMetadataEditable(experiment)

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Hosted experiment"
        title={experiment.name}
        description={experiment.objective}
        actions={
          <StatusPill tone={statusTone(experiment.lifecycleStatus)} dot>
            {formatStatus(experiment.lifecycleStatus)}
          </StatusPill>
        }
      />
      <DataModeNotice compact mode="supabase" />
      {canEditDraft ? (
        <Panel eyebrow="Editable draft" title="Name and objective">
          <div className="panel-action-row">
            <p className="safe-note">
              <ShieldCheck size={14} aria-hidden="true" /> Metadata changes are
              revision-checked and audited. Execution settings stay disabled.
            </p>
            <HostedDraftEditor
              experimentId={experiment.id}
              operationId={draftOperationId}
              expectedRevision={experiment.draftRevision}
              name={experiment.name}
              objective={experiment.objective}
            />
          </div>
        </Panel>
      ) : null}
      <Panel eyebrow="Owner controls" title="Read-only lifecycle state">
        {experiment.controls ? (
          <div className="configuration-grid">
            <div className="configuration-item">
              <span>Scheduler</span>
              <strong>
                {enabledLabel(experiment.controls.schedulerEnabled)}
              </strong>
              <small>Hosted control state</small>
            </div>
            <div className="configuration-item">
              <span>Agent</span>
              <strong>{enabledLabel(experiment.controls.agentEnabled)}</strong>
              <small>Paid calls remain disabled</small>
            </div>
            <div className="configuration-item">
              <span>Emergency pause</span>
              <strong>
                {experiment.controls.emergencyPaused ? 'Active' : 'Clear'}
              </strong>
              <small>
                {experiment.controls.pauseReason ?? 'No pause reason'}
              </small>
            </div>
            <div className="configuration-item">
              <span>Control version</span>
              <strong className="mono">
                {experiment.controls.stateVersion}
              </strong>
              <small>Exact database bigint</small>
            </div>
          </div>
        ) : (
          <p className="safe-note">
            <Database size={14} aria-hidden="true" /> No control row exists for
            this experiment.
          </p>
        )}
      </Panel>
      <div className="dashboard-grid dashboard-grid--primary">
        <Panel
          className="dashboard-grid__wide"
          eyebrow="Current record"
          title="Experiment configuration"
        >
          <div className="configuration-grid">
            <div className="configuration-item">
              <span>Initial capital</span>
              <strong className="mono">
                {experiment.baseCurrency} {experiment.initialCapital}
              </strong>
              <small>Exact decimal string</small>
            </div>
            <div className="configuration-item">
              <span>Execution mode</span>
              <strong>
                {experiment.executionMode
                  ? formatStatus(experiment.executionMode)
                  : 'Not selected'}
              </strong>
              <small>Separate from lifecycle state</small>
            </div>
            <div className="configuration-item">
              <span>Started</span>
              <strong>{formatOptionalDate(experiment.startsAt)}</strong>
              <small>UTC</small>
            </div>
            <div className="configuration-item">
              <span>Ended</span>
              <strong>{formatOptionalDate(experiment.endsAt)}</strong>
              <small>UTC</small>
            </div>
          </div>
        </Panel>
        <Panel eyebrow="Immutable lock" title="Version state">
          <p className="safe-note">
            <LockKeyhole size={14} aria-hidden="true" />
            {lockedVersion
              ? `Version ${lockedVersion.version} locked ${formatOptionalDate(experiment.lockedAt)}`
              : 'Draft rules are not locked yet.'}
          </p>
          <dl className="definition-list">
            <div>
              <dt>Experiment ID</dt>
              <dd className="mono">{experiment.id}</dd>
            </div>
            <div>
              <dt>Draft revision</dt>
              <dd className="mono">{experiment.draftRevision}</dd>
            </div>
            <div>
              <dt>Locked version ID</dt>
              <dd className="mono">
                {experiment.lockedVersionId ?? 'Not created'}
              </dd>
            </div>
          </dl>
        </Panel>
      </div>
      <div className="dashboard-grid dashboard-grid--split">
        <Panel eyebrow="Immutable references" title="Version manifest">
          {lockedVersion ? (
            <dl className="definition-list">
              <div>
                <dt>Snapshot capital</dt>
                <dd className="mono">
                  {lockedVersion.baseCurrency} {lockedVersion.initialCapital}
                </dd>
              </div>
              <div>
                <dt>Content hash</dt>
                <dd className="mono">{lockedVersion.contentHash}</dd>
              </div>
              <div>
                <dt>Snapshot objective</dt>
                <dd>{lockedVersion.objective}</dd>
              </div>
              <div>
                <dt>Version created</dt>
                <dd>{formatUtc(lockedVersion.createdAt)}</dd>
              </div>
              {lockedVersion.references.map((reference) => (
                <div key={reference.label}>
                  <dt>{reference.label}</dt>
                  <dd className="mono">{reference.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="safe-note">
              <ShieldCheck size={14} aria-hidden="true" /> No immutable version
              exists while this experiment remains a draft.
            </p>
          )}
        </Panel>
        <Panel eyebrow="Audit trail" title="Recent status events">
          {experiment.statusEvents.length ? (
            <div className="timeline">
              {experiment.statusEvents.map((event) => (
                <article className="timeline__item" key={event.id}>
                  <span
                    className={`timeline__marker timeline__marker--${statusTone(event.toStatus)}`}
                    aria-hidden="true"
                  />
                  <div>
                    <time>{formatUtc(event.occurredAt)}</time>
                    <strong>
                      {event.fromStatus
                        ? `${formatStatus(event.fromStatus)} → `
                        : ''}
                      {formatStatus(event.toStatus)}
                    </strong>
                    <p>
                      {formatStatus(event.reasonCode)} · {event.actorType}
                      {event.reason ? ` · ${event.reason}` : ''}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="safe-note">
              <Database size={14} aria-hidden="true" /> No status events have
              been recorded.
            </p>
          )}
        </Panel>
      </div>
    </div>
  )
}
