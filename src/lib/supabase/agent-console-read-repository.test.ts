import { afterEach, describe, expect, it, vi } from 'vitest'

const logMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/logging/logger', () => ({ log: logMock }))

import type { HostedAgentConsoleClient } from './agent-console-read-repository'
import {
  decisionAtForHostedAgentConsoleRead,
  readHostedAgentConsoleWithClient,
} from './agent-console-read-repository'

const ownerId = '00000000-0000-4000-8000-000000000001'
const decisionAt = '2026-08-09T12:00:00.000Z'

function clientFixture(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result)
  return { client: { rpc } as unknown as HostedAgentConsoleClient, rpc }
}

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('readHostedAgentConsoleWithClient', () => {
  it('uses a small historical boundary instead of a possibly future app clock', () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-08-09T12:00:00.000Z')
    expect(decisionAtForHostedAgentConsoleRead()).toBe(
      '2026-08-09T11:59:55.000Z',
    )
  })

  it('requests one bounded owner snapshot', async () => {
    const fixture = clientFixture({
      data: [
        {
          owner_id: ownerId,
          decision_at: decisionAt,
          run_rows: [],
          decision_rows: [],
          evidence_rows: [],
          tool_call_rows: [],
        },
      ],
      error: null,
    })

    await expect(
      readHostedAgentConsoleWithClient(fixture.client, ownerId, decisionAt),
    ).resolves.toEqual({
      source: 'supabase',
      decisionAt,
      runs: [],
      decisions: [],
      evidence: [],
      toolCalls: [],
    })
    expect(fixture.rpc).toHaveBeenCalledWith('hosted_agent_console_read', {
      p_decision_at: decisionAt,
      p_run_limit: 100,
    })
  })

  it('sanitizes RPC and validation failures', async () => {
    const fixture = clientFixture({
      data: null,
      error: { message: 'sensitive database detail' },
    })

    await expect(
      readHostedAgentConsoleWithClient(fixture.client, ownerId, decisionAt),
    ).rejects.toThrow('Hosted agent console read failed')
    expect(logMock).toHaveBeenCalledWith(
      'error',
      'Hosted agent console read failed',
      {
        operation: 'agent_console_read',
        errorClass: 'HostedAgentConsoleInternalError',
      },
    )
  })

  it('classifies an owner-boundary mismatch as validation failure', async () => {
    const fixture = clientFixture({
      data: [
        {
          owner_id: '00000000-0000-4000-8000-000000000099',
          decision_at: decisionAt,
          run_rows: [],
          decision_rows: [],
          evidence_rows: [],
          tool_call_rows: [],
        },
      ],
      error: null,
    })

    await expect(
      readHostedAgentConsoleWithClient(fixture.client, ownerId, decisionAt),
    ).rejects.toThrow('Hosted agent console read failed')
    expect(logMock).toHaveBeenCalledWith(
      'error',
      'Hosted agent console read failed',
      {
        operation: 'agent_console_validation',
        errorClass: 'HostedAgentConsoleInternalError',
      },
    )
  })
})
