import { describe, expect, it } from 'vitest'

import {
  mapHostedExperimentStartReadiness,
  parseHostedExperimentStartForm,
  type HostedExperimentStartReadinessRow,
} from './start-hosted-draft'

const experimentId = '11111111-1111-4111-8111-111111111111'
const universeId = '22222222-2222-4222-8222-222222222222'
const calendarId = '33333333-3333-4333-8333-333333333333'

function form(overrides: Record<string, string> = {}) {
  const data = new FormData()
  const values = {
    operationId: '44444444-4444-4444-8444-444444444444',
    experimentId,
    expectedDraftRevision: '0',
    expectedControlStateVersion: '0',
    mode: 'replay',
    confirmation: 'START REPLAY',
    ...overrides,
  }
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}

const readinessRow: HostedExperimentStartReadinessRow = {
  experiment_id: experimentId,
  decision_at: '2026-08-08T12:00:00.000Z',
  draft_revision: '0',
  control_state_version: '0',
  draft_ready: true,
  start_manifest_id: 'capital_lab_disabled_runtime_start_v1',
  market_manifest_id: 'capital_lab_us_core_alpaca_iex_v1',
  universe_id: universeId,
  calendar_manifest_id: 'capital_lab_us_equities_calendar_2026_v1',
  calendar_manifest_record_id: calendarId,
  ready: true,
}

describe('parseHostedExperimentStartForm', () => {
  it('accepts exact replay and shadow confirmations', () => {
    expect(parseHostedExperimentStartForm(form())).toMatchObject({
      success: true,
      data: { mode: 'replay', confirmation: 'START REPLAY' },
    })
    expect(
      parseHostedExperimentStartForm(
        form({ mode: 'shadow', confirmation: 'START SHADOW' }),
      ),
    ).toMatchObject({
      success: true,
      data: { mode: 'shadow', confirmation: 'START SHADOW' },
    })
  })

  it('rejects live-paper, mismatched confirmation, and noncanonical revisions', () => {
    expect(
      parseHostedExperimentStartForm(
        form({ mode: 'live_paper', confirmation: 'START LIVE PAPER' }),
      ),
    ).toMatchObject({ success: false })
    expect(
      parseHostedExperimentStartForm(form({ confirmation: 'start replay' })),
    ).toMatchObject({
      success: false,
      state: { fieldErrors: { confirmation: 'Enter START REPLAY exactly' } },
    })
    expect(
      parseHostedExperimentStartForm(form({ expectedDraftRevision: '01' })),
    ).toMatchObject({ success: false })
  })
})

describe('mapHostedExperimentStartReadiness', () => {
  it('maps the complete reviewed readiness projection', () => {
    expect(
      mapHostedExperimentStartReadiness(readinessRow, experimentId),
    ).toEqual({
      status: 'available',
      experimentId,
      decisionAt: '2026-08-08T12:00:00.000Z',
      draftRevision: '0',
      controlStateVersion: '0',
      draftReady: true,
      startManifestId: 'capital_lab_disabled_runtime_start_v1',
      marketManifestId: 'capital_lab_us_core_alpaca_iex_v1',
      universeId,
      calendarManifestId: 'capital_lab_us_equities_calendar_2026_v1',
      calendarManifestRecordId: calendarId,
      ready: true,
    })
  })

  it('preserves truthful blocked manifest states', () => {
    expect(
      mapHostedExperimentStartReadiness(
        {
          ...readinessRow,
          market_manifest_id: null,
          universe_id: null,
          ready: false,
        },
        experimentId,
      ),
    ).toMatchObject({
      status: 'available',
      marketManifestId: null,
      universeId: null,
      ready: false,
    })
  })

  it('fails closed on partial or contradictory database rows', () => {
    expect(
      mapHostedExperimentStartReadiness(
        { ...readinessRow, calendar_manifest_record_id: null },
        experimentId,
      ),
    ).toEqual({ status: 'unavailable' })
    expect(
      mapHostedExperimentStartReadiness(
        { ...readinessRow, experiment_id: universeId },
        experimentId,
      ),
    ).toEqual({ status: 'unavailable' })
    expect(
      mapHostedExperimentStartReadiness(
        {
          ...readinessRow,
          draft_revision: '9223372036854775808',
        },
        experimentId,
      ),
    ).toEqual({ status: 'unavailable' })
    expect(
      mapHostedExperimentStartReadiness(
        { ...readinessRow, market_manifest_id: 'unreviewed-market' },
        experimentId,
      ),
    ).toEqual({ status: 'unavailable' })
  })
})
