import { Bot, BrainCircuit, FileSearch, Wrench } from 'lucide-react'

import { DataModeNotice } from '@/components/ui/data-mode-notice'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { Panel } from '@/components/ui/panel'
import { StatusPill } from '@/components/ui/status-pill'
import { TableShell } from '@/components/ui/table-shell'
import type { HostedAgentConsole } from '@/features/agent/hosted-agent-console'
import type { HostedAgentRuntimeReadiness } from '@/features/agent/hosted-agent-runtime-readiness'
import { formatStatus, formatUtc } from '@/lib/formatting'
import type { Tone } from '@/lib/mock/types'

function runTone(status: string): Tone {
  if (status === 'completed') return 'positive'
  if (status === 'failed' || status === 'unknown') return 'warning'
  if (status === 'running') return 'info'
  return 'neutral'
}

function shortId(value: string): string {
  return value.slice(0, 8)
}

export function HostedAgentView({
  console,
  runtime,
  decisionAt,
}: {
  console: HostedAgentConsole | null
  runtime: HostedAgentRuntimeReadiness
  decisionAt: string
}) {
  const evidenceByDecision = new Map<string, number>()
  for (const evidence of console?.evidence ?? []) {
    evidenceByDecision.set(
      evidence.decisionId,
      (evidenceByDecision.get(evidence.decisionId) ?? 0) + 1,
    )
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="AI observability"
        title="Agent console"
        description="Owner-scoped structured runs, concise rationale, scenarios, evidence, tool calls, and exact settled cost—never hidden chain-of-thought."
        actions={
          <StatusPill
            tone={runtime.ready ? 'info' : 'neutral'}
            dot={runtime.ready}
          >
            {runtime.ready ? 'Shadow ready' : 'Calls disabled'}
          </StatusPill>
        }
      />
      <DataModeNotice mode="supabase" hostedActivity={runtime.message} />

      <Panel
        eyebrow="Server projection"
        title="Runtime boundary"
        action={
          <time className="as-of" dateTime={decisionAt}>
            {formatUtc(decisionAt)}
          </time>
        }
      >
        <dl className="definition-list">
          <div>
            <dt>Provider calls</dt>
            <dd>{runtime.ready ? 'Reviewed shadow only' : 'Disabled'}</dd>
          </div>
          <div>
            <dt>Broker connectivity</dt>
            <dd>Unavailable</dd>
          </div>
          <div>
            <dt>Persisted runs</dt>
            <dd>{console?.runs.length ?? 'Unavailable'}</dd>
          </div>
          <div>
            <dt>Structured decisions</dt>
            <dd>{console?.decisions.length ?? 'Unavailable'}</dd>
          </div>
        </dl>
      </Panel>

      <Panel eyebrow="Immutable routing" title="Agent runs">
        {!console ? (
          <EmptyState
            icon={Bot}
            title="Hosted agent console is unavailable"
            description="The owner-only point-in-time contract did not return a valid snapshot. No mock runs are substituted."
          />
        ) : console.runs.length === 0 ? (
          <EmptyState
            icon={Bot}
            title="No hosted agent runs yet"
            description="Agent calls remain disabled, so no paid model call, proposal, simulated order, or fill has been created."
          />
        ) : (
          <TableShell caption="Hosted structured agent runs">
            <thead>
              <tr>
                <th scope="col">Decision at</th>
                <th scope="col">Role / model</th>
                <th scope="col">Routing</th>
                <th scope="col">Status</th>
                <th scope="col" className="numeric">
                  Tokens
                </th>
                <th scope="col" className="numeric">
                  Cost USD
                </th>
              </tr>
            </thead>
            <tbody>
              {console.runs.map((run) => (
                <tr key={run.id}>
                  <td>
                    <div className="symbol-cell">
                      <strong>{formatUtc(run.decisionAt)}</strong>
                      <span>{shortId(run.id)}</span>
                    </div>
                  </td>
                  <td>
                    <div className="symbol-cell">
                      <strong>{formatStatus(run.role)}</strong>
                      <span>{run.model}</span>
                    </div>
                  </td>
                  <td>{formatStatus(run.routingReason)}</td>
                  <td>
                    <StatusPill tone={runTone(run.status)}>
                      {formatStatus(run.status)}
                    </StatusPill>
                  </td>
                  <td className="numeric">
                    {run.inputTokens === null || run.outputTokens === null
                      ? '—'
                      : `${run.inputTokens} / ${run.outputTokens}`}
                  </td>
                  <td className="numeric">
                    {run.actualCostUsd === null ? '—' : `$${run.actualCostUsd}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </Panel>

      <Panel eyebrow="Structured output" title="Decisions and scenarios">
        {!console || console.decisions.length === 0 ? (
          <EmptyState
            icon={BrainCircuit}
            title="No structured shadow decisions yet"
            description="No rationale or scenarios are shown until the database contains a validated owner-scoped decision."
          />
        ) : (
          <div className="candidate-list">
            {console.decisions.map((decision) => (
              <article className="candidate-card" key={decision.id}>
                <div className="candidate-card__rank">
                  {shortId(decision.id)}
                </div>
                <div>
                  <div className="event-card__meta">
                    <span>{formatStatus(decision.decisionType)}</span>
                    <time dateTime={decision.decidedAt}>
                      {formatUtc(decision.decidedAt)}
                    </time>
                  </div>
                  <h3>{decision.conciseRationale}</h3>
                  <p>
                    {decision.proposal
                      ? `${formatStatus(decision.proposal.expectedDirection)} · ${decision.proposal.expectedReturnRangeBps.minimum} to ${decision.proposal.expectedReturnRangeBps.maximum} bps`
                      : 'Legacy structured output; no current proposal schema is claimed.'}
                  </p>
                  {decision.proposal ? (
                    <div className="scenario-grid">
                      {Object.entries(decision.proposal.scenarios).map(
                        ([name, scenario]) => (
                          <article key={name}>
                            <span>
                              {formatStatus(name)}
                              <strong>{scenario.probabilityPercent}%</strong>
                            </span>
                            <p>{scenario.summary}</p>
                          </article>
                        ),
                      )}
                    </div>
                  ) : null}
                  <div className="candidate-card__footer">
                    <span>{formatStatus(decision.proposalStatus)}</span>
                    <strong>
                      {evidenceByDecision.get(decision.id) ?? 0} citations
                    </strong>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </Panel>

      <div className="content-grid content-grid--two">
        <Panel eyebrow="Point-in-time" title="Evidence" compact>
          {!console || console.evidence.length === 0 ? (
            <EmptyState
              icon={FileSearch}
              title="No persisted citations"
              description="Evidence appears only after a validated structured decision is stored."
            />
          ) : (
            <TableShell caption="Hosted decision evidence">
              <thead>
                <tr>
                  <th scope="col">Available</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Citation</th>
                </tr>
              </thead>
              <tbody>
                {console.evidence.map((evidence) => (
                  <tr key={evidence.id}>
                    <td>{formatUtc(evidence.evidenceAvailableAt)}</td>
                    <td>{formatStatus(evidence.evidenceKind)}</td>
                    <td>{evidence.citationLabel}</td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          )}
        </Panel>

        <Panel eyebrow="Auditable tools" title="Tool calls" compact>
          {!console || console.toolCalls.length === 0 ? (
            <EmptyState
              icon={Wrench}
              title="No persisted tool calls"
              description="The console never invents model or tool activity when the runtime is disabled."
            />
          ) : (
            <TableShell caption="Hosted agent tool calls">
              <thead>
                <tr>
                  <th scope="col">Started</th>
                  <th scope="col">Tool</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {console.toolCalls.map((toolCall) => (
                  <tr key={toolCall.id}>
                    <td>{formatUtc(toolCall.startedAt)}</td>
                    <td>{formatStatus(toolCall.toolName)}</td>
                    <td>{formatStatus(toolCall.status)}</td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          )}
        </Panel>
      </div>
    </div>
  )
}
