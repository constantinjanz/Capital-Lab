import { describe, expect, it, vi } from 'vitest'

import { writeHostedMarketConfiguration } from './market-configuration-write-repository'

const operationId = 'd3000000-0000-4000-8000-000000000001'
const universeId = 'a3000000-0000-4000-8000-000000000001'
const sourceId = 'b3000000-0000-4000-8000-000000000001'
const input = { operationId }

function row(replayed = false) {
  return {
    operation_id: operationId,
    status: 'configured',
    universe_id: universeId,
    source_id: sourceId,
    replayed,
  }
}

describe('hosted market configuration write repository', () => {
  it.each([false, true])(
    'calls only the fixed-manifest RPC and maps replayed=%s',
    async (replayed) => {
      const rpc = vi.fn().mockResolvedValue({
        data: [row(replayed)],
        error: null,
      })

      await expect(
        writeHostedMarketConfiguration({ rpc } as never, input),
      ).resolves.toEqual({
        ok: true,
        operationId,
        universeId,
        sourceId,
        replayed,
      })
      expect(rpc).toHaveBeenCalledWith('configure_hosted_market_manifest', {
        p_operation_id: operationId,
      })
    },
  )

  it.each(['22023', '23505', '23514', '42501', '55000'])(
    'maps definite SQL rejection %s without exposing database detail',
    async (code) => {
      const rpc = vi.fn().mockResolvedValue({
        data: null,
        error: { code, message: 'raw database conflict detail' },
      })

      await expect(
        writeHostedMarketConfiguration({ rpc } as never, input),
      ).resolves.toEqual({ ok: false, reason: 'rejected' })
    },
  )

  it.each([
    { data: null, error: { code: 'PGRST000', message: 'transport detail' } },
    { data: null, error: { message: 'missing status code' } },
    { data: [], error: null },
    { data: [row(), row(true)], error: null },
    {
      data: [
        {
          ...row(),
          operation_id: 'd3000000-0000-4000-8000-000000000999',
        },
      ],
      error: null,
    },
    { data: [{ ...row(), source_id: 'not-a-uuid' }], error: null },
  ])('maps an unconfirmed RPC outcome to unknown', async (response) => {
    const rpc = vi.fn().mockResolvedValue(response)

    await expect(
      writeHostedMarketConfiguration({ rpc } as never, input),
    ).resolves.toEqual({ ok: false, reason: 'unknown' })
  })

  it('maps a thrown transport failure to unknown', async () => {
    const rpc = vi.fn().mockRejectedValue(new Error('connection reset'))

    await expect(
      writeHostedMarketConfiguration({ rpc } as never, input),
    ).resolves.toEqual({ ok: false, reason: 'unknown' })
  })
})
