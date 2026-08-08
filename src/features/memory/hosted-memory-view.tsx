import { BrainCircuit, ShieldCheck } from 'lucide-react'

import { DataModeNotice } from '@/components/ui/data-mode-notice'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { Panel } from '@/components/ui/panel'
import { StatusPill } from '@/components/ui/status-pill'
import { TableShell } from '@/components/ui/table-shell'
import type { HostedDecisionMemory } from '@/features/memory/hosted-decision-memory'
import type { HostedLearningSnapshot } from '@/features/memory/hosted-learning-snapshot'
import {
  HostedPatternReviewControls,
  type HostedPatternReviewOperationIds,
} from '@/features/memory/hosted-pattern-review-controls'
import { formatStatus, formatUtc } from '@/lib/formatting'

function shortId(value: string): string {
  return value.slice(0, 8)
}

function exact(value: string | null): string {
  return value ?? 'Unavailable'
}

export function HostedMemoryView({
  memory,
  learning,
  decisionAt,
  patternReviewOperationIds,
}: {
  memory: HostedDecisionMemory | null
  learning: HostedLearningSnapshot | null
  decisionAt: string
  patternReviewOperationIds: Record<string, HostedPatternReviewOperationIds>
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
          <StatusPill
            tone={memory && learning ? 'positive' : 'warning'}
            dot={!!memory && !!learning}
          >
            {memory && learning ? 'Evidence measured' : 'Read incomplete'}
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

      <Panel
        eyebrow="Deterministic learning"
        title="Evidence statistics"
        action={<span className="as-of">Exact database decimals</span>}
      >
        {learning ? (
          <dl className="definition-list">
            <div>
              <dt>Calibration bands</dt>
              <dd>{learning.calibration.length}</dd>
            </div>
            <div>
              <dt>Decision categories</dt>
              <dd>{learning.categories.length}</dd>
            </div>
            <div>
              <dt>Outcome horizons</dt>
              <dd>{learning.horizons.length}</dd>
            </div>
            <div>
              <dt>Reviewed patterns</dt>
              <dd>{learning.patterns.length}</dd>
            </div>
          </dl>
        ) : (
          <EmptyState
            icon={BrainCircuit}
            title="Hosted learning statistics are unavailable"
            description="The owner-only aggregate contract did not return a valid point-in-time snapshot. No browser-side or mock statistics are substituted."
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
            <ShieldCheck size={14} aria-hidden="true" /> Outcomes are measured
            labels only. This read path cannot run agents or create simulated
            orders, fills, ledger entries, or allocations.
          </p>
        </>
      ) : null}

      {learning ? (
        <>
          <Panel
            eyebrow="Confidence quality"
            title="Calibration bands"
            action={<span className="as-of">1-day measured outcomes</span>}
          >
            {learning.calibration.length === 0 ? (
              <EmptyState
                icon={BrainCircuit}
                title="No confidence observations yet"
                description="Calibration appears after hosted decisions record exact confidence values. Unevaluated decisions remain visible without being treated as hits or misses."
              />
            ) : (
              <TableShell caption="Hosted confidence calibration statistics">
                <thead>
                  <tr>
                    <th scope="col">Confidence band</th>
                    <th scope="col" className="numeric">
                      Decisions
                    </th>
                    <th scope="col" className="numeric">
                      Evaluated
                    </th>
                    <th scope="col" className="numeric">
                      Mean confidence
                    </th>
                    <th scope="col" className="numeric">
                      Observed hit rate
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {learning.calibration.map((statistic) => (
                    <tr key={statistic.bandIndex}>
                      <td className="mono">
                        {statistic.bandLower}–{statistic.bandUpper}
                      </td>
                      <td className="numeric mono">
                        {statistic.decisionCount}
                      </td>
                      <td className="numeric mono">
                        {statistic.evaluatedCount}
                      </td>
                      <td className="numeric mono">
                        {exact(statistic.meanConfidence)}
                      </td>
                      <td className="numeric mono">
                        {exact(statistic.observedHitRate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            )}
          </Panel>

          <Panel
            eyebrow="Outcome segmentation"
            title="Decision categories"
            action={<span className="as-of">Exact aggregate strings</span>}
          >
            {learning.categories.length === 0 ? (
              <EmptyState
                icon={BrainCircuit}
                title="No hosted decision categories yet"
                description="Category statistics remain empty until immutable hosted decisions are present at this timestamp."
              />
            ) : (
              <TableShell caption="Hosted decision category statistics">
                <thead>
                  <tr>
                    <th scope="col">Decision</th>
                    <th scope="col" className="numeric">
                      Decisions
                    </th>
                    <th scope="col" className="numeric">
                      Evaluated
                    </th>
                    <th scope="col" className="numeric">
                      Hit rate
                    </th>
                    <th scope="col" className="numeric">
                      Mean forward
                    </th>
                    <th scope="col" className="numeric">
                      Mean benchmark relative
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {learning.categories.map((statistic) => (
                    <tr key={statistic.decisionType}>
                      <td>{formatStatus(statistic.decisionType)}</td>
                      <td className="numeric mono">
                        {statistic.decisionCount}
                      </td>
                      <td className="numeric mono">
                        {statistic.evaluatedCount}
                      </td>
                      <td className="numeric mono">
                        {exact(statistic.hitRate)}
                      </td>
                      <td className="numeric mono">
                        {exact(statistic.meanForwardReturn)}
                      </td>
                      <td className="numeric mono">
                        {exact(statistic.meanBenchmarkRelativeReturn)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            )}
          </Panel>

          <Panel
            eyebrow="Evidence composition"
            title="Citations and outcome horizons"
            action={<span className="as-of">Available by decisionAt</span>}
          >
            <div className="lifecycle-control-grid">
              <div className="lifecycle-control-card">
                <h3>Evidence kinds</h3>
                {learning.evidenceKinds.length === 0 ? (
                  <p className="muted-copy">No eligible citations yet.</p>
                ) : (
                  <dl className="definition-list">
                    {learning.evidenceKinds.map((statistic) => (
                      <div key={statistic.evidenceKind}>
                        <dt>{formatStatus(statistic.evidenceKind)}</dt>
                        <dd className="mono">
                          {statistic.citationCount} citations ·{' '}
                          {statistic.decisionCount} decisions
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
              <div className="lifecycle-control-card">
                <h3>Outcome horizons</h3>
                {learning.horizons.length === 0 ? (
                  <p className="muted-copy">No measured horizons yet.</p>
                ) : (
                  <dl className="definition-list">
                    {learning.horizons.map((statistic) => (
                      <div key={statistic.horizon}>
                        <dt>{formatStatus(statistic.horizon)}</dt>
                        <dd className="mono">
                          {statistic.outcomeCount} outcomes · hit{' '}
                          {statistic.hitRate} · relative{' '}
                          {statistic.meanBenchmarkRelativeReturn}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            </div>
          </Panel>

          <Panel
            eyebrow="Owner-reviewed lifecycle"
            title="Pattern hypotheses"
            action={
              <StatusPill tone="neutral">
                {learning.patterns.length} bounded
              </StatusPill>
            }
          >
            {learning.patterns.length === 0 ? (
              <EmptyState
                icon={BrainCircuit}
                title="No hosted pattern hypotheses yet"
                description="Patterns appear only after an explicit hypothesis and its fixed evidence policy have been persisted. Nothing is inferred or promoted automatically."
              />
            ) : (
              <div className="page-stack">
                {learning.patterns.map((pattern) => {
                  const operationIds = patternReviewOperationIds[pattern.id]
                  return (
                    <article
                      className="lifecycle-control-card"
                      key={pattern.id}
                    >
                      <div className="symbol-cell">
                        <StatusPill
                          tone={
                            pattern.lifecycleStatus === 'eligible' ||
                            pattern.lifecycleStatus === 'active'
                              ? 'positive'
                              : pattern.lifecycleStatus === 'rejected' ||
                                  pattern.lifecycleStatus === 'retired'
                                ? 'negative'
                                : 'neutral'
                          }
                        >
                          {formatStatus(pattern.lifecycleStatus)}
                        </StatusPill>
                        <h3>{pattern.name}</h3>
                        <p>{pattern.hypothesis}</p>
                        <code>{shortId(pattern.id)}</code>
                      </div>
                      <dl className="definition-list">
                        <div>
                          <dt>Independent 1-day outcomes</dt>
                          <dd className="mono">
                            {pattern.independentObservations}
                          </dd>
                        </div>
                        <div>
                          <dt>Hit rate</dt>
                          <dd className="mono">{exact(pattern.hitRate)}</dd>
                        </div>
                        <div>
                          <dt>Mean benchmark relative</dt>
                          <dd className="mono">
                            {exact(pattern.meanBenchmarkRelativeReturn)}
                          </dd>
                        </div>
                        <div>
                          <dt>Worst MAE</dt>
                          <dd className="mono">
                            {exact(pattern.worstMaximumAdverseExcursion)}
                          </dd>
                        </div>
                        <div>
                          <dt>Holdout</dt>
                          <dd>
                            {pattern.holdoutPassed ? 'Passed' : 'Not passed'}
                          </dd>
                        </div>
                        <div>
                          <dt>Deterministic gate</dt>
                          <dd>
                            {pattern.eligible ? 'Passes' : 'Does not pass'}
                          </dd>
                        </div>
                      </dl>
                      {pattern.reasons.length > 0 ? (
                        <p className="muted-copy">
                          Gate reasons:{' '}
                          {pattern.reasons.map(formatStatus).join(', ')}
                        </p>
                      ) : (
                        <p className="safe-note">
                          <ShieldCheck size={14} aria-hidden="true" /> The fixed
                          evidence gate passes. Owner review can mark this
                          hypothesis eligible, but cannot activate or allocate
                          it.
                        </p>
                      )}
                      {operationIds ? (
                        <HostedPatternReviewControls
                          patternId={pattern.id}
                          patternName={pattern.name}
                          expectedStatus={pattern.lifecycleStatus}
                          operationIds={operationIds}
                        />
                      ) : null}
                    </article>
                  )
                })}
              </div>
            )}
          </Panel>

          <Panel
            eyebrow="Read-only routing state"
            title="Current strategy assignments"
            action={<span className="as-of">No mutation control here</span>}
          >
            {learning.assignments.length === 0 ? (
              <EmptyState
                icon={BrainCircuit}
                title="No active strategy assignments"
                description="Pattern eligibility never creates a champion or challenger assignment. Allocation requires a separate future review boundary."
              />
            ) : (
              <TableShell caption="Current hosted strategy assignments">
                <thead>
                  <tr>
                    <th scope="col">Experiment</th>
                    <th scope="col">Assignment</th>
                    <th scope="col">Strategy version</th>
                    <th scope="col" className="numeric">
                      Allocation
                    </th>
                    <th scope="col">Valid from</th>
                  </tr>
                </thead>
                <tbody>
                  {learning.assignments.map((assignment) => (
                    <tr key={assignment.id}>
                      <td>
                        <code>{shortId(assignment.experimentId)}</code>
                      </td>
                      <td>{formatStatus(assignment.assignmentType)}</td>
                      <td>
                        {assignment.strategyName} v{assignment.strategyVersion}
                      </td>
                      <td className="numeric mono">
                        {assignment.allocationFraction}
                      </td>
                      <td>
                        <time dateTime={assignment.validFrom}>
                          {formatUtc(assignment.validFrom)}
                        </time>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            )}
          </Panel>

          <p className="safe-note">
            <ShieldCheck size={14} aria-hidden="true" /> This slice stops at
            deterministic measurement and owner-reviewed eligibility. It does
            not activate patterns, change champion/challenger allocation, run an
            agent, or touch the paper simulator.
          </p>
        </>
      ) : null}
    </div>
  )
}
