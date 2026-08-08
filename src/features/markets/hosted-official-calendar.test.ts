import { describe, expect, it } from 'vitest'

import {
  HOSTED_OFFICIAL_CALENDAR_MANIFEST_ID,
  mapHostedOfficialCalendarConfigurationResult,
  mapHostedOfficialCalendarState,
  parseHostedOfficialCalendarConfigurationForm,
} from './hosted-official-calendar'

const ownerId = '00000000-0000-4000-8000-000000000001'
const operationId = 'd3000000-0000-4000-8000-000000000001'
const manifestRecordId = 'e3000000-0000-4000-8000-000000000001'
const decisionAt = '2026-08-08T10:00:00.000Z'

function configuredStateRow() {
  return {
    owner_id: ownerId,
    decision_at: decisionAt,
    configured: true,
    manifest_id: HOSTED_OFFICIAL_CALENDAR_MANIFEST_ID,
    manifest_record_id: manifestRecordId,
    calendar_year: 2026,
    exchange_count: 2,
    session_count: 522,
    regular_session_count: 498,
    early_close_session_count: 4,
    closed_session_count: 20,
  }
}

describe('hosted official calendar contract mapping', () => {
  it('accepts only an operation id from the setup form', () => {
    const data = new FormData()
    data.set('operationId', operationId)
    data.set('ownerId', '00000000-0000-4000-8000-000000000999')
    data.set('schedulerEnabled', 'true')
    data.set('sourceUrl', 'https://example.invalid')

    expect(parseHostedOfficialCalendarConfigurationForm(data)).toEqual({
      success: true,
      data: { operationId },
    })
  })

  it('rejects an invalid setup operation', () => {
    const data = new FormData()
    data.set('operationId', 'not-a-uuid')

    expect(parseHostedOfficialCalendarConfigurationForm(data)).toMatchObject({
      success: false,
      state: {
        status: 'error',
        fieldErrors: { operationId: expect.any(String) },
      },
    })
  })

  it.each([false, true])(
    'maps a complete result with replayed=%s',
    (replayed) => {
      expect(
        mapHostedOfficialCalendarConfigurationResult(
          [
            {
              operation_id: operationId,
              status: 'configured',
              manifest_record_id: manifestRecordId,
              source_count: 2,
              session_count: 522,
              replayed,
            },
          ],
          operationId,
        ),
      ).toEqual({
        operationId,
        manifestRecordId,
        sourceCount: 2,
        sessionCount: 522,
        replayed,
      })
    },
  )

  it.each([
    [[]],
    [[{ ...configuredStateRow(), owner_id: 'not-a-uuid' }]],
    [[{ ...configuredStateRow(), session_count: 521 }]],
    [[{ ...configuredStateRow(), regular_session_count: 499 }]],
    [[{ ...configuredStateRow(), manifest_id: 'unreviewed' }]],
  ])('rejects malformed or incomplete configured state %#', (data) => {
    expect(() => mapHostedOfficialCalendarState(data, ownerId)).toThrow()
  })

  it('maps the exact database-attested configured state', () => {
    expect(
      mapHostedOfficialCalendarState([configuredStateRow()], ownerId),
    ).toEqual({
      status: 'configured',
      decisionAt,
      manifestId: HOSTED_OFFICIAL_CALENDAR_MANIFEST_ID,
      manifestRecordId,
      calendarYear: 2026,
      exchangeCount: 2,
      sessionCount: 522,
      regularSessionCount: 498,
      earlyCloseSessionCount: 4,
      closedSessionCount: 20,
    })
  })

  it('maps an evidence-free unconfigured state', () => {
    expect(
      mapHostedOfficialCalendarState(
        [
          {
            ...configuredStateRow(),
            configured: false,
            manifest_id: null,
            manifest_record_id: null,
            exchange_count: 0,
            session_count: 0,
            regular_session_count: 0,
            early_close_session_count: 0,
            closed_session_count: 0,
          },
        ],
        ownerId,
      ),
    ).toEqual({
      status: 'unconfigured',
      decisionAt,
      calendarYear: 2026,
    })
  })

  it('accepts the UTC offset emitted by hosted PostgREST', () => {
    const hostedDecisionAt = '2026-08-08T12:09:48.046771+00:00'

    expect(
      mapHostedOfficialCalendarState(
        [
          {
            ...configuredStateRow(),
            decision_at: hostedDecisionAt,
            configured: false,
            manifest_id: null,
            manifest_record_id: null,
            exchange_count: 0,
            session_count: 0,
            regular_session_count: 0,
            early_close_session_count: 0,
            closed_session_count: 0,
          },
        ],
        ownerId,
      ),
    ).toEqual({
      status: 'unconfigured',
      decisionAt: hostedDecisionAt,
      calendarYear: 2026,
    })
  })

  it('rejects cross-owner state and unconfigured evidence', () => {
    expect(() =>
      mapHostedOfficialCalendarState([configuredStateRow()], operationId),
    ).toThrow()
    expect(() =>
      mapHostedOfficialCalendarState(
        [
          {
            ...configuredStateRow(),
            configured: false,
            manifest_id: null,
            manifest_record_id: null,
          },
        ],
        ownerId,
      ),
    ).toThrow()
  })
})
