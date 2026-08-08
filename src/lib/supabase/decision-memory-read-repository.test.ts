import { afterEach, describe, expect, it, vi } from 'vitest'

const logMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/logging/logger', () => ({ log: logMock }))

import type { HostedDecisionMemoryClient } from './decision-memory-read-repository'
import {
  decisionAtForHostedMemoryRead,
  readHostedDecisionMemoryWithClient,
} from './decision-memory-read-repository'

const ownerId = '00000000-0000-4000-8000-000000000001'
const decisionAt = '2026-08-08T12:00:00.000Z'

type QueryResult = { data: unknown; error: unknown }

const snapshotRow = {
  owner_id: ownerId,
  decision_at: decisionAt,
  context_rows: [],
  decision_rows: [],
  evidence_rows: [],
  outcome_rows: [],
}

function clientFixture(
  options: { result?: QueryResult; rpcThrows?: Error } = {},
) {
  const rpc = vi.fn(
    async (
      name: string,
      args?: Record<string, unknown>,
    ): Promise<QueryResult> => {
      void args
      if (options.rpcThrows) throw options.rpcThrows
      if (name === 'hosted_decision_memory_read') {
        return options.result ?? { data: [snapshotRow], error: null }
      }
      throw new Error(`Unexpected RPC ${name}`)
    },
  )
  return {
    client: { rpc } as unknown as HostedDecisionMemoryClient,
    rpc,
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('readHostedDecisionMemoryWithClient', () => {
  it('uses a small historical boundary instead of a possibly future app clock', () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-08-08T12:00:00.000Z')

    expect(decisionAtForHostedMemoryRead()).toBe('2026-08-08T11:59:55.000Z')
  })

  it('requests one bounded point-in-time database snapshot without fetch', async () => {
    const fixture = clientFixture()
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const memory = await readHostedDecisionMemoryWithClient(
      fixture.client,
      ownerId,
      decisionAt,
    )

    expect(memory).toEqual({
      source: 'supabase',
      decisionAt,
      contexts: [],
      decisions: [],
      evidence: [],
      outcomes: [],
    })
    expect(fixture.rpc).toHaveBeenCalledTimes(1)
    expect(fixture.rpc).toHaveBeenCalledWith('hosted_decision_memory_read', {
      p_context_limit: 100,
      p_decision_at: decisionAt,
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('sanitizes database failures at the repository boundary', async () => {
    const fixture = clientFixture({
      result: {
        data: null,
        error: { message: 'sensitive database detail' },
      },
    })

    await expect(
      readHostedDecisionMemoryWithClient(fixture.client, ownerId, decisionAt),
    ).rejects.toThrow('Hosted decision memory read failed')
    expect(logMock).toHaveBeenCalledWith(
      'error',
      'Hosted decision memory read failed',
      {
        operation: 'memory_read',
        errorClass: 'HostedDecisionMemoryInternalError',
      },
    )
  })

  it('fails closed when the RPC crosses the owner boundary', async () => {
    const fixture = clientFixture({
      result: {
        data: [
          {
            ...snapshotRow,
            owner_id: '00000000-0000-4000-8000-000000000099',
          },
        ],
        error: null,
      },
    })

    await expect(
      readHostedDecisionMemoryWithClient(fixture.client, ownerId, decisionAt),
    ).rejects.toThrow('Hosted decision memory read failed')
    expect(logMock).toHaveBeenCalledWith(
      'error',
      'Hosted decision memory read failed',
      {
        operation: 'memory_validation',
        errorClass: 'HostedDecisionMemoryInternalError',
      },
    )
  })

  it('classifies a thrown transport failure without logging its detail', async () => {
    const fixture = clientFixture({
      rpcThrows: new Error('sensitive transport detail'),
    })

    await expect(
      readHostedDecisionMemoryWithClient(fixture.client, ownerId, decisionAt),
    ).rejects.toThrow('Hosted decision memory read failed')
    expect(logMock).toHaveBeenCalledWith(
      'error',
      'Hosted decision memory read failed',
      {
        operation: 'memory_read',
        errorClass: 'HostedDecisionMemoryInternalError',
      },
    )
  })
})
