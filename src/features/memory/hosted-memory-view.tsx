import { BrainCircuit, ShieldCheck } from 'lucide-react'

import { DataModeNotice } from '@/components/ui/data-mode-notice'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { Panel } from '@/components/ui/panel'
import { StatusPill } from '@/components/ui/status-pill'
import { TableShell } from '@/components/ui/table-shell'
import type { HostedDecisionMemory } from '@/features/memory/hosted-decision-memory'
import { formatStatus, formatUtc } from '@/lib/formatting'

function shortId(value: string): string {
  return value.slice(0, 8)
}

function exact(value: string | null): string {
  return value ?? 'Unavailable'
}

export function HostedMemoryView({
  memory,
  decisionAt,
}: {
  memory: HostedDecisionMemory | null
  decisionAt: string
}) {
  const decisionsByContext = new Map(
    memory?.decisions.map((decision) => [decision.contextSnapshotId, decision]),
  )
  const evidenceCounts = new Map<string, number>()
  const outcomeCounts = new Map<string, number>()
  for (const evidence of memory?.evidence ?? []) {
    evidenceCounts.set(
      evidence.decisionId,
      (evidenceCounts.get(evidence.decisionId) ?? 0) + 1,
    )
  }
  for (const outcome of memory?.outcomes ?? []) {
    outcomeCounts.set(
      outcome.decisionId,
      (outcomeCounts.get(outcome.decisionId) ?? 0) + 1,
    )
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Persisted decision evidence"
        title="Memory & learning"
        description="Owner-scoped immutable contexts, decisions, citations, and measured paper outcomes at one required decision timestamp."
        actions={
          <StatusPill tone={memory ? 'positive' : 'warning'} dot={!!memory}>
            {memory ? 'Read-only evidence' : 'Read unavailable'}
          </StatusPill>
        }
      />
      <DataModeNotice mode="supabase" />

      <Panel
        eyebrow="Decision boundary"
        title="Hosted memory snapshot"
        action={
          <time className="as-of" dateTime={decisionAt}>
            {formatUtc(decisionAt)}
          </time>
        }
      >
        {memory ? (
          <dl className="definition-list">
            <div>
              <dt>Immutable contexts</dt>
              <dd>{memory.contexts.length}</dd>
            </div>
            <div>
              <dt>Linked decisions</dt>
              <dd>{memory.decisions.length}</dd>
            </div>
            <div>
              <dt>Point-in-time citations</dt>
              <dd>{memory.evidence.length}</dd>
            </div>
            <div>
              <dt>Measured outcomes</dt>
              <dd>{memory.outcomes.length}</dd>
            </div>
          </dl>
        ) : (
          <EmptyState
            icon={BrainCircuit}
            title="Hosted decision memory is unavailable"
            description="The owner-only point-in-time contract did not return a valid snapshot. No mock contexts or outcomes are substituted."
          />
        )}
      </Panel>

      {memory ? (
        <>
          <Panel
            eyebrow="Immutable provenance"
            title="Decision contexts"
            action={<span className="as-of">Latest 100 contexts</span>}
          >
            {memory.contexts.length === 0 ? (
              <EmptyState
                icon={BrainCircuit}
                title="No hosted decision contexts yet"
                description="Agent execution remains disabled, so the hosted project has not recorded a decision context. No synthetic context is shown."
              />
            ) : (
              <TableShell caption="Immutable hosted decision contexts">
                <thead>
                  <tr>
                    <th scope="col">Decision at</th>
                    <th scope="col">Experiment version</th>
                    <th scope="col">Agent provenance</th>
                    <th scope="col">Decision</th>
                    <th scope="col" className="numeric">
                      Citations
                    </th>
                    <th scope="col" className="numeric">
                      Outcomes
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {memory.contexts.map((context) => {
                    const decision = decisionsByContext.get(context.id)
                    return (
                      <tr key={context.id}>
                        <td>
                          <div className="symbol-cell">
                            <strong>
                              <time dateTime={context.decisionAt}>
                                {formatUtc(context.decisionAt)}
                              </time>
                            </strong>
                            <code>{shortId(context.id)}</code>
                          </div>
                        </td>
                        <td>
                          <div className="symbol-cell">
                            <strong>v{context.experimentVersion}</strong>
                            <code>{shortId(context.experimentId)}</code>
                          </div>
                        </td>
                        <td>
                          <div className="symbol-cell">
                            <strong>{formatStatus(context.agentRole)}</strong>
                            <span>{context.model}</span>
                          </div>
                        </td>
                        <td>
                          {decision ? (
                            <div className="symbol-cell">
                              <StatusPill
                                tone={
                                  decision.proposalStatus === 'rejected'
                                    ? 'negative'
                                    : decision.proposalStatus === 'accepted'
                                      ? 'positive'
                                      : 'neutral'
                                }
                              >
                                {formatStatus(decision.proposalStatus)}
                              </StatusPill>
                              <span>
                                {formatStatus(decision.decisionType)} ·{' '}
                                {decision.conciseRationale}
                              </span>
                            </div>
                          ) : (
                            'Not recorded'
                          )}
                        </td>
                        <td className="numeric mono">
                          {decision
                            ? (evidenceCounts.get(decision.id) ?? 0)
                            : 0}
                        </td>
                        <td className="numeric mono">
                          {decision ? (outcomeCounts.get(decision.id) ?? 0) : 0}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </TableShell>
            )}
          </Panel>

          <Panel
            eyebrow="Measured feedback"
            title="Outcome labels"
            action={<span className="as-of">Exact database decimals</span>}
          >
            {memory.outcomes.length === 0 ? (
              <EmptyState
                icon={BrainCircuit}
                title="No eligible outcomes yet"
                description="Outcome rows appear only after their measurement timestamp. Future labels are excluded by the database and application boundaries."
              />
            ) : (
              <TableShell caption="Measured hosted decision outcomes">
                <thead>
                  <tr>
                    <th scope="col">Decision</th>
                    <th scope="col">Horizon</th>
                    <th scope="col">Evaluated at</th>
                    <th scope="col" className="numeric">
                      Forward return
                    </th>
                    <th scope="col" className="numeric">
                      Benchmark relative
                    </th>
                    <th scope="col" className="numeric">
                      MFE
                    </th>
                    <th scope="col" className="numeric">
                      MAE
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {memory.outcomes.map((outcome) => (
                    <tr key={outcome.id}>
                      <td>
                        <code>{shortId(outcome.decisionId)}</code>
                      </td>
                      <td>{formatStatus(outcome.horizon)}</td>
                      <td>
                        <time dateTime={outcome.evaluatedAt}>
                          {formatUtc(outcome.evaluatedAt)}
                        </time>
                      </td>
                      <td className="numeric mono">
                        {exact(outcome.forwardReturn)}
                      </td>
                      <td className="numeric mono">
                        {exact(outcome.benchmarkRelativeReturn)}
                      </td>
                      <td className="numeric mono">
                        {exact(outcome.maximumFavorableExcursion)}
                      </td>
                      <td className="numeric mono">
                        {exact(outcome.maximumAdverseExcursion)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            )}
          </Panel>

          <p className="safe-note">
            <ShieldCheck size={14} aria-hidden="true" /> Pattern promotion and
            champion/challenger allocation are not enabled by this view. They
            require separate deterministic evidence gates and owner review.
          </p>
        </>
      ) : null}
    </div>
  )
}
