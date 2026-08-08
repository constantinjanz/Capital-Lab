import { beforeEach, describe, expect, it, vi } from 'vitest'

const logMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/logging/logger', () => ({ log: logMock }))

import { readHostedOfficialCalendarStateWithClient } from './official-calendar-read-repository'

const ownerId = '00000000-0000-4000-8000-000000000001'
const manifestRecordId = 'e3000000-0000-4000-8000-000000000001'
const decisionAt = '2026-08-08T10:00:00.000Z'

function configuredRow() {
  return {
    owner_id: ownerId,
    decision_at: decisionAt,
    configured: true,
    manifest_id: 'capital_lab_us_equities_calendar_2026_v1',
    manifest_record_id: manifestRecordId,
    calendar_year: 2026,
    exchange_count: 2,
    session_count: 522,
    regular_session_count: 498,
    early_close_session_count: 4,
    closed_session_count: 20,
  }
}

describe('official calendar read repository', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls only the owner-attested state RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [configuredRow()],
      error: null,
    })

    await expect(
      readHostedOfficialCalendarStateWithClient({ rpc } as never, ownerId),
    ).resolves.toMatchObject({
      status: 'configured',
      manifestRecordId,
      sessionCount: 522,
    })
    expect(rpc).toHaveBeenCalledWith('hosted_official_calendar_state')
    expect(logMock).not.toHaveBeenCalled()
  })

  it.each([
    [{ data: null, error: { message: 'raw RPC detail' } }],
    [{ data: [], error: null }],
    [{ data: [{ ...configuredRow(), session_count: 521 }], error: null }],
  ])(
    'fails closed for an unavailable or invalid response',
    async (responses) => {
      const rpc = vi.fn().mockResolvedValue(responses)

      await expect(
        readHostedOfficialCalendarStateWithClient({ rpc } as never, ownerId),
      ).resolves.toEqual({ status: 'unavailable', calendarYear: 2026 })
    },
  )

  it('fails closed for a thrown transport error', async () => {
    const rpc = vi.fn().mockRejectedValue(new Error('raw transport detail'))

    await expect(
      readHostedOfficialCalendarStateWithClient({ rpc } as never, ownerId),
    ).resolves.toEqual({ status: 'unavailable', calendarYear: 2026 })
  })
})
