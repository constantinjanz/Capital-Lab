import { describe, expect, it } from 'vitest'

import { mapHostedDecisionMemoryResult } from './hosted-decision-memory'

const ownerId = '00000000-0000-4000-8000-000000000001'
const contextId = '10000000-0000-4000-8000-000000000001'
const runId = '20000000-0000-4000-8000-000000000001'
const experimentId = '30000000-0000-4000-8000-000000000001'
const experimentVersionId = '40000000-0000-4000-8000-000000000001'
const decisionId = '50000000-0000-4000-8000-000000000001'
const evidenceId = '60000000-0000-4000-8000-000000000001'
const eventRevisionId = '70000000-0000-4000-8000-000000000001'
const outcomeId = '80000000-0000-4000-8000-000000000001'
const decisionAt = '2026-08-08T12:00:00.000Z'
const contextDecisionAt = '2026-08-08T11:00:00.000Z'

const contextRow = {
  id: contextId,
  owner_id: ownerId,
  agent_run_id: runId,
  experiment_id: experimentId,
  experiment_version_id: experimentVersionId,
  experiment_version: 3,
  experiment_version_content_hash: 'a'.repeat(64),
  strategy_version_id: null,
  decision_at: contextDecisionAt,
  portfolio_snapshot_id: null,
  portfolio_as_of: null,
  net_liquidation_value_text: null,
  drawdown_fraction_text: null,
  agent_role: 'luna',
  run_type: 'market_cycle',
  model: 'disabled-fixture-model',
  prompt_version_id: null,
  routing_reason: 'deterministic fixture',
  context_manifest: { fixture: true },
  content_hash: 'b'.repeat(64),
  created_at: contextDecisionAt,
}

const decisionRow = {
  id: decisionId,
  owner_id: ownerId,
  context_snapshot_id: contextId,
  agent_run_id: runId,
  experiment_id: experimentId,
  decision_type: 'abstain',
  instrument_id: null,
  structured_output: { abstentionReason: 'fixture' },
  concise_rationale: 'No action in this deterministic fixture.',
  confidence_text: '0.95000',
  proposal_status: 'abstained',
  rejection_reason_code: null,
  decided_at: contextDecisionAt,
  created_at: contextDecisionAt,
}

const evidenceRow = {
  id: evidenceId,
  owner_id: ownerId,
  decision_id: decisionId,
  evidence_kind: 'event',
  market_quote_id: null,
  market_bar_id: null,
  event_revision_id: eventRevisionId,
  knowledge_chunk_id: null,
  prior_decision_id: null,
  evidence_available_at: '2026-08-08T10:59:00.000Z',
  citation_label: 'event:fixture:r1',
  created_at: contextDecisionAt,
}

const outcomeRow = {
  id: outcomeId,
  owner_id: ownerId,
  decision_id: decisionId,
  horizon: '15m',
  evaluated_at: '2026-08-08T11:15:00.000Z',
  forward_return_text: '9007199254740993.123456789012',
  benchmark_relative_return_text: '0.002345678901',
  maximum_favorable_excursion_text: '0.020000000000',
  maximum_adverse_excursion_text: '-0.005000000000',
  thesis_valid: true,
  execution_outcome: { fills: 0 },
  created_at: '2026-08-08T11:15:00.000Z',
}

function result(
  overrides: Partial<{
    owner_id: unknown
    decision_at: unknown
    context_rows: unknown
    decision_rows: unknown
    evidence_rows: unknown
    outcome_rows: unknown
  }> = {},
) {
  return [
    {
      owner_id: ownerId,
      decision_at: decisionAt,
      context_rows: [contextRow],
      decision_rows: [decisionRow],
      evidence_rows: [evidenceRow],
      outcome_rows: [outcomeRow],
      ...overrides,
    },
  ]
}

describe('mapHostedDecisionMemoryResult', () => {
  it('maps one linked point-in-time memory graph without numeric coercion', () => {
    const memory = mapHostedDecisionMemoryResult(result(), ownerId, decisionAt)

    expect(memory).toMatchObject({
      source: 'supabase',
      decisionAt,
      contexts: [{ id: contextId, experimentVersion: 3 }],
      decisions: [{ id: decisionId, confidence: '0.95' }],
      evidence: [{ id: evidenceId, referenceId: eventRevisionId }],
    })
    expect(memory.outcomes[0]?.forwardReturn).toBe(
      '9007199254740993.123456789012',
    )
    expect(memory.outcomes[0]?.maximumFavorableExcursion).toBe('0.02')
  })

  it('returns an honest empty hosted state', () => {
    expect(
      mapHostedDecisionMemoryResult(
        result({
          context_rows: [],
          decision_rows: [],
          evidence_rows: [],
          outcome_rows: [],
        }),
        ownerId,
        decisionAt,
      ),
    ).toEqual({
      source: 'supabase',
      decisionAt,
      contexts: [],
      decisions: [],
      evidence: [],
      outcomes: [],
    })
  })

  it('fails closed across top-level and nested owner boundaries', () => {
    expect(() =>
      mapHostedDecisionMemoryResult(
        result({ owner_id: '00000000-0000-4000-8000-000000000099' }),
        ownerId,
        decisionAt,
      ),
    ).toThrow('owner boundary')

    expect(() =>
      mapHostedDecisionMemoryResult(
        result({
          outcome_rows: [
            {
              ...outcomeRow,
              owner_id: '00000000-0000-4000-8000-000000000099',
            },
          ],
        }),
        ownerId,
        decisionAt,
      ),
    ).toThrow('owner boundary')
  })

  it('rejects future evidence at the decision and snapshot boundaries', () => {
    expect(() =>
      mapHostedDecisionMemoryResult(
        result({
          evidence_rows: [
            {
              ...evidenceRow,
              evidence_available_at: '2026-08-08T11:00:01.000Z',
            },
          ],
        }),
        ownerId,
        decisionAt,
      ),
    ).toThrow('evidence decision availability timestamp')

    expect(() =>
      mapHostedDecisionMemoryResult(
        result({
          evidence_rows: [
            {
              ...evidenceRow,
              evidence_available_at: '2026-08-08T12:00:01.000Z',
            },
          ],
        }),
        ownerId,
        decisionAt,
      ),
    ).toThrow('future evidence availability timestamp')
  })

  it('rejects decision scope and time drift from the immutable context', () => {
    expect(() =>
      mapHostedDecisionMemoryResult(
        result({
          decision_rows: [
            {
              ...decisionRow,
              agent_run_id: '20000000-0000-4000-8000-000000000099',
            },
          ],
        }),
        ownerId,
        decisionAt,
      ),
    ).toThrow('inconsistent decision scope')

    expect(() =>
      mapHostedDecisionMemoryResult(
        result({
          decision_rows: [
            {
              ...decisionRow,
              decided_at: '2026-08-08T11:00:01.000Z',
            },
          ],
        }),
        ownerId,
        decisionAt,
      ),
    ).toThrow('inconsistent decision time')
  })

  it('rejects JavaScript numbers in exact financial fields', () => {
    expect(() =>
      mapHostedDecisionMemoryResult(
        result({
          outcome_rows: [{ ...outcomeRow, forward_return_text: 0.1 }],
        }),
        ownerId,
        decisionAt,
      ),
    ).toThrow('invalid forward return')
  })

  it('rejects invalid outcome chronology and excursion signs', () => {
    expect(() =>
      mapHostedDecisionMemoryResult(
        result({
          outcome_rows: [{ ...outcomeRow, evaluated_at: contextDecisionAt }],
        }),
        ownerId,
        decisionAt,
      ),
    ).toThrow('invalid outcome boundary')

    expect(() =>
      mapHostedDecisionMemoryResult(
        result({
          outcome_rows: [
            { ...outcomeRow, maximum_favorable_excursion_text: '-0.01' },
          ],
        }),
        ownerId,
        decisionAt,
      ),
    ).toThrow('invalid maximum favorable excursion')
  })

  it('rejects inconsistent evidence references and request timestamps', () => {
    expect(() =>
      mapHostedDecisionMemoryResult(
        result({
          evidence_rows: [{ ...evidenceRow, market_quote_id: eventRevisionId }],
        }),
        ownerId,
        decisionAt,
      ),
    ).toThrow('inconsistent evidence references')

    expect(() =>
      mapHostedDecisionMemoryResult(
        result({ decision_at: '2026-08-08T12:00:01.000Z' }),
        ownerId,
        decisionAt,
      ),
    ).toThrow('inconsistent decisionAt')
  })
})
