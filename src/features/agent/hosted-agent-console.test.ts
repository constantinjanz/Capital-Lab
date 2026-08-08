import { describe, expect, it } from 'vitest'

import { mapHostedAgentConsoleResult } from './hosted-agent-console'

const ownerId = '00000000-0000-4000-8000-000000000001'
const runId = '10000000-0000-4000-8000-000000000001'
const experimentId = '20000000-0000-4000-8000-000000000001'
const promptVersionId = '30000000-0000-4000-8000-000000000001'
const decisionId = '40000000-0000-4000-8000-000000000001'
const evidenceId = '50000000-0000-4000-8000-000000000001'
const evidenceReferenceId = '60000000-0000-4000-8000-000000000001'
const toolCallId = '70000000-0000-4000-8000-000000000001'
const runDecisionAt = '2026-08-09T12:00:00.000Z'
const snapshotAt = '2026-08-09T12:01:00.000Z'

const proposal = {
  decisionType: 'abstain',
  eventIds: [],
  evidenceIds: [evidenceReferenceId],
  thesis: 'Point-in-time evidence remains insufficient.',
  scenarios: {
    bull: { summary: 'Evidence improves.', probabilityPercent: 20 },
    base: { summary: 'Evidence remains mixed.', probabilityPercent: 60 },
    bear: { summary: 'Evidence weakens.', probabilityPercent: 20 },
  },
  confidencePercent: 60,
  expectedDirection: 'uncertain',
  expectedReturnRangeBps: { minimum: '-25', maximum: '50.5' },
  intendedHorizon: '1_hour',
  invalidationConditions: ['New evidence changes the assessment.'],
  urgency: 'normal',
  escalationRequested: false,
  abstentionReason: 'No bounded paper exposure is justified.',
}

function resultRow() {
  return {
    owner_id: ownerId,
    decision_at: snapshotAt,
    run_rows: [
      {
        id: runId,
        experimentId,
        role: 'terra',
        runType: 'hosted_shadow_v1',
        model: 'gpt-5.6-terra',
        promptVersionId,
        status: 'completed',
        routingReason: 'exceptional_deterministic_trigger',
        decisionAt: runDecisionAt,
        startedAt: '2026-08-09T12:00:01.000Z',
        finishedAt: '2026-08-09T12:00:02.000Z',
        inputTokens: '20',
        cachedInputTokens: '5',
        outputTokens: '10',
        reasoningTokens: '2',
        webSearchCalls: '0',
        actualCostUsd: '0.00015100',
        latencyMs: '125',
        finishState: 'completed',
      },
    ],
    decision_rows: [
      {
        id: decisionId,
        agentRunId: runId,
        experimentId,
        decisionType: 'abstain',
        instrumentId: null,
        structuredOutput: proposal,
        conciseRationale: proposal.thesis,
        confidence: '0.60000',
        proposalStatus: 'shadow',
        rejectionReasonCode: null,
        decidedAt: runDecisionAt,
      },
    ],
    evidence_rows: [
      {
        id: evidenceId,
        decisionId,
        evidenceKind: 'knowledge',
        evidenceId: evidenceReferenceId,
        evidenceAvailableAt: '2026-08-09T11:59:00.000Z',
        citationLabel: 'knowledge:reviewed-source',
      },
    ],
    tool_call_rows: [
      {
        id: toolCallId,
        agentRunId: runId,
        sequenceNo: '1',
        toolName: 'submit_trade_proposal',
        requestSummary: { paper_only: true },
        responseSummary: {
          proposal_status: 'shadow',
          paper_orders_created: 0,
        },
        startedAt: runDecisionAt,
        finishedAt: '2026-08-09T12:00:02.000Z',
        status: 'completed',
      },
    ],
  }
}

describe('mapHostedAgentConsoleResult', () => {
  it('maps one bounded owner snapshot with exact decimals and structured scenarios', () => {
    expect(
      mapHostedAgentConsoleResult([resultRow()], ownerId, snapshotAt),
    ).toEqual({
      source: 'supabase',
      decisionAt: snapshotAt,
      runs: [
        expect.objectContaining({
          id: runId,
          actualCostUsd: '0.000151',
          inputTokens: '20',
          status: 'completed',
        }),
      ],
      decisions: [
        expect.objectContaining({
          id: decisionId,
          confidence: '0.6',
          proposal,
        }),
      ],
      evidence: [
        expect.objectContaining({
          id: evidenceId,
          evidenceId: evidenceReferenceId,
        }),
      ],
      toolCalls: [expect.objectContaining({ id: toolCallId, sequenceNo: '1' })],
    })
  })

  it('fails closed when the RPC crosses the owner boundary', () => {
    const row = resultRow()
    row.owner_id = '00000000-0000-4000-8000-000000000099'
    expect(() =>
      mapHostedAgentConsoleResult([row], ownerId, snapshotAt),
    ).toThrow('Hosted agent console crossed the owner boundary')
  })

  it('rejects future evidence relative to its persisted decision', () => {
    const row = resultRow()
    row.evidence_rows[0].evidenceAvailableAt = '2026-08-09T12:00:30.000Z'
    expect(() =>
      mapHostedAgentConsoleResult([row], ownerId, snapshotAt),
    ).toThrow('Hosted agent console has a future decision evidence')
  })

  it('rejects hidden or unknown fields in a hosted structured proposal', () => {
    const row = resultRow()
    const decisionRow = row.decision_rows[0] as { structuredOutput: unknown }
    decisionRow.structuredOutput = {
      ...proposal,
      hiddenReasoning: 'must never cross the boundary',
    }
    expect(() =>
      mapHostedAgentConsoleResult([row], ownerId, snapshotAt),
    ).toThrow('Hosted agent console has an invalid structured proposal')
  })

  it('allows legacy non-runtime decisions without pretending they match the proposal schema', () => {
    const row = resultRow()
    row.run_rows[0].runType = 'decision_memory_fixture'
    const decisionRow = row.decision_rows[0] as { structuredOutput: unknown }
    decisionRow.structuredOutput = { fixture: true }

    const result = mapHostedAgentConsoleResult([row], ownerId, snapshotAt)
    expect(result.decisions[0]?.proposal).toBeNull()
  })
})
