import { describe, expect, it, vi } from 'vitest'

import { writeHostedOfficialCalendarConfiguration } from './official-calendar-write-repository'

const operationId = 'd3000000-0000-4000-8000-000000000001'
const manifestRecordId = 'e3000000-0000-4000-8000-000000000001'

function row(replayed = false) {
  return {
    operation_id: operationId,
    status: 'configured',
    manifest_record_id: manifestRecordId,
    source_count: 2,
    session_count: 522,
    replayed,
  }
}

describe('official calendar write repository', () => {
  it.each([false, true])(
    'calls only the fixed calendar RPC and maps replayed=%s',
    async (replayed) => {
      const rpc = vi.fn().mockResolvedValue({
        data: [row(replayed)],
        error: null,
      })

      await expect(
        writeHostedOfficialCalendarConfiguration({ rpc } as never, {
          operationId,
        }),
      ).resolves.toEqual({
        ok: true,
        operationId,
        manifestRecordId,
        sourceCount: 2,
        sessionCount: 522,
        replayed,
      })
      expect(rpc).toHaveBeenCalledWith(
        'configure_hosted_official_calendar_manifest',
        { p_operation_id: operationId },
      )
    },
  )

  it.each(['22023', '23505', '23514', '42501', '55000'])(
    'maps definite SQL rejection %s without raw detail',
    async (code) => {
      const rpc = vi.fn().mockResolvedValue({
        data: null,
        error: { code, message: 'raw database detail' },
      })

      await expect(
        writeHostedOfficialCalendarConfiguration({ rpc } as never, {
          operationId,
        }),
      ).resolves.toEqual({ ok: false, reason: 'rejected' })
    },
  )

  it.each([
    { data: null, error: { code: 'PGRST000' } },
    { data: [], error: null },
    { data: [{ ...row(), session_count: 521 }], error: null },
    { data: [{ ...row(), source_count: 3 }], error: null },
  ])('maps unconfirmed RPC response %# to unknown', async (response) => {
    const rpc = vi.fn().mockResolvedValue(response)

    await expect(
      writeHostedOfficialCalendarConfiguration({ rpc } as never, {
        operationId,
      }),
    ).resolves.toEqual({ ok: false, reason: 'unknown' })
  })

  it('maps a thrown transport failure to unknown', async () => {
    const rpc = vi.fn().mockRejectedValue(new Error('transport detail'))

    await expect(
      writeHostedOfficialCalendarConfiguration({ rpc } as never, {
        operationId,
      }),
    ).resolves.toEqual({ ok: false, reason: 'unknown' })
  })
})
