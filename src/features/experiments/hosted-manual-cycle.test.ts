import { describe, expect, it } from 'vitest'

import {
  mapHostedManualCycleState,
  parseHostedManualCycleForm,
  type HostedManualCycleStateRow,
} from './hosted-manual-cycle'

const experimentId = 'e5000000-0000-4000-8000-000000000001'

function validForm() {
  const form = new FormData()
  form.set('operationId', 'd5000000-0000-4000-8000-000000000001')
  form.set('experimentId', experimentId)
  form.set('expectedControlStateVersion', '9007199254740993')
  form.set('decisionAt', '2026-08-08T15:45:02.000+00:00')
  form.set('confirmation', 'RUN PAPER CYCLE')
  return form
}

function readyRow(): HostedManualCycleStateRow {
  return {
    experiment_id: experimentId,
    decision_at: '2026-08-08T15:45:02.000+00:00',
    control_state_version: '9007199254740993',
    scheduler_provider: 'manual',
    ready: true,
    reason: null,
    last_scheduler_run_id: null,
    last_simulator_run_id: null,
    last_slot_key: null,
    last_status: null,
    last_reason: null,
    last_decision_at: null,
  }
}

describe('hosted manual cycle contract', () => {
  it('parses only the exact owner confirmation and exact string revision', () => {
    expect(parseHostedManualCycleForm(validForm())).toEqual({
      success: true,
      data: {
        operationId: 'd5000000-0000-4000-8000-000000000001',
        experimentId,
        expectedControlStateVersion: '9007199254740993',
        decisionAt: '2026-08-08T15:45:02.000+00:00',
        confirmation: 'RUN PAPER CYCLE',
      },
    })
  })

  it.each([
    ['confirmation', 'run paper cycle'],
    ['expectedControlStateVersion', '01'],
    ['expectedControlStateVersion', '9223372036854775808'],
    ['decisionAt', '2027-01-01T00:00:00.000Z'],
  ])('rejects invalid %s input', (field, value) => {
    const form = validForm()
    form.set(field, value)
    const parsed = parseHostedManualCycleForm(form)
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.state.status).toBe('error')
      expect(parsed.state.fieldErrors?.[field as 'confirmation']).toBeTruthy()
    }
  })

  it('maps a ready state without inventing a prior cycle', () => {
    expect(mapHostedManualCycleState(readyRow(), experimentId)).toEqual({
      status: 'available',
      experimentId,
      decisionAt: '2026-08-08T15:45:02.000+00:00',
      controlStateVersion: '9007199254740993',
      schedulerProvider: 'manual',
      ready: true,
      reason: null,
      lastRun: null,
    })
  })

  it('maps only complete sanitized skipped-run evidence', () => {
    expect(
      mapHostedManualCycleState(
        {
          ...readyRow(),
          last_scheduler_run_id: 'e5000000-0000-4000-8000-000000000002',
          last_simulator_run_id: 'e5000000-0000-4000-8000-000000000003',
          last_slot_key: `hosted-paper-cycle:${experimentId}:2026-08-08T15:45:00Z`,
          last_status: 'skipped',
          last_reason: 'market_closed',
          last_decision_at: '2026-08-08T15:45:01.000+00:00',
        },
        experimentId,
      ),
    ).toMatchObject({
      status: 'available',
      lastRun: {
        status: 'skipped',
        reason: 'market_closed',
        schedulerRunId: 'e5000000-0000-4000-8000-000000000002',
        simulatorRunId: 'e5000000-0000-4000-8000-000000000003',
      },
    })
  })

  it('preserves a known blocked state instead of presenting a usable action', () => {
    expect(
      mapHostedManualCycleState(
        {
          ...readyRow(),
          scheduler_provider: null,
          ready: false,
          reason: 'scheduler_provider_not_manual',
        },
        experimentId,
      ),
    ).toMatchObject({
      status: 'available',
      ready: false,
      reason: 'scheduler_provider_not_manual',
    })
  })

  it.each([
    { ready: true, reason: 'market_closed' },
    { last_status: 'completed' },
    { last_reason: 'agent_disabled' },
    { last_scheduler_run_id: 'not-a-uuid' },
    { control_state_version: '01' },
  ])('fails closed on malformed state %#', (change) => {
    const row = {
      ...readyRow(),
      last_scheduler_run_id: 'e5000000-0000-4000-8000-000000000002',
      last_simulator_run_id: 'e5000000-0000-4000-8000-000000000003',
      last_slot_key: `hosted-paper-cycle:${experimentId}:2026-08-08T15:45:00Z`,
      last_status: 'skipped',
      last_reason: 'market_closed',
      last_decision_at: '2026-08-08T15:45:01.000+00:00',
      ...change,
    }
    expect(mapHostedManualCycleState(row, experimentId)).toEqual({
      status: 'unavailable',
    })
  })
})
