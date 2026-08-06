import { describe, expect, it } from 'vitest'

import type { HostedExperimentDetailRow } from './hosted-experiment-detail'
import { mapHostedExperimentDetail } from './hosted-experiment-detail'

const detailRow: HostedExperimentDetailRow = {
  id: 'experiment-id',
  owner_id: 'owner-id',
  name: 'Precision study',
  lifecycle_status: 'completed',
  execution_mode: 'replay',
  base_currency: 'EUR',
  initial_capital: '9007199254740993.12345678',
  objective: 'Preserve exact values',
  starts_at: '2026-08-03T13:30:00.000Z',
  ends_at: '2026-08-05T20:00:00.000Z',
  lifecycle_pause_reason: null,
  locked_at: '2026-08-03T13:29:00.000Z',
  locked_version_id: 'version-id',
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-05T20:00:00.000Z',
  scheduler_enabled: false,
  agent_enabled: false,
  emergency_paused: false,
  control_pause_reason: null,
  control_state_version: '9007199254740993',
  locked_version: 1,
  locked_initial_capital: '9007199254740993.12345678',
  locked_base_currency: 'EUR',
  locked_objective: 'Preserve exact values',
  locked_version_content_hash: '8'.repeat(64),
  market_universe_id: 'universe-id',
  simulator_config_version_id: 'simulator-id',
  risk_config_version_id: 'risk-id',
  model_routing_version_id: 'routing-id',
  data_source_config_version_id: 'data-id',
  agent_prompt_version_id: null,
  knowledge_corpus_version_id: null,
  budget_policy_id: null,
  locked_version_created_at: '2026-08-03T13:29:00.000Z',
}

describe('mapHostedExperimentDetail', () => {
  it('preserves decimal and bigint strings without numeric coercion', () => {
    const detail = mapHostedExperimentDetail(detailRow, [])

    expect(detail.initialCapital).toBe('9007199254740993.12345678')
    expect(detail.lockedVersion?.initialCapital).toBe(
      '9007199254740993.12345678',
    )
    expect(detail.controls?.stateVersion).toBe('9007199254740993')
  })

  it('maps owner-scoped lifecycle events in database order', () => {
    const detail = mapHostedExperimentDetail(detailRow, [
      {
        id: 'event-id',
        from_status: 'active',
        to_status: 'completed',
        reason_code: 'replay_complete',
        reason: null,
        actor_type: 'system',
        correlation_id: 'correlation-id',
        occurred_at: '2026-08-05T20:00:00.000Z',
      },
    ])

    expect(detail.statusEvents[0]).toMatchObject({
      fromStatus: 'active',
      toStatus: 'completed',
      actorType: 'system',
    })
  })

  it('fails closed when joined control state is partial', () => {
    expect(() =>
      mapHostedExperimentDetail({ ...detailRow, scheduler_enabled: null }, []),
    ).toThrow('partial control state')
  })

  it('fails closed for unsupported lifecycle states', () => {
    expect(() =>
      mapHostedExperimentDetail(
        { ...detailRow, lifecycle_status: 'unknown' },
        [],
      ),
    ).toThrow('unsupported lifecycle state')
  })
})
