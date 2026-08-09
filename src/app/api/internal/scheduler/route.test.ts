import { describe, expect, it, vi } from 'vitest'

import type { ServerEnvironment } from '@/lib/env/server'

import { handleSchedulerPost } from './route'

const safeEnvironment = {
  SCHEDULER_SHARED_SECRET: 's'.repeat(48),
  SCHEDULER_ENABLED: true,
  SCHEDULER_PROVIDER: 'supabase',
  AGENT_ENABLED: false,
  AGENT_EXECUTION_MODE: 'mock',
  AUTONOMOUS_PAPER_EXECUTION_ENABLED: false,
  PAID_MODEL_CALLS_ENABLED: false,
  OPENAI_CANARY_ENABLED: false,
  OPENAI_WEB_SEARCH_ENABLED: false,
  SOL_ENABLED: false,
  SOL_CHALLENGER_ENABLED: false,
  SOL_LIVE_EXECUTION_ENABLED: false,
  REAL_BROKER_ENABLED: false,
} as ServerEnvironment

function request(secret = safeEnvironment.SCHEDULER_SHARED_SECRET) {
  return new Request('https://capital-lab.example/api/internal/scheduler', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ job: 'market_dispatcher' }),
  })
}

function dependencies(
  dispatch = vi.fn().mockResolvedValue({
    status: 'completed',
    reason: 'no_ai_shadow_cycle_recorded',
    cyclesClaimed: 1,
    cyclesReconciled: 0,
    modelCalls: 0,
    paperOrdersCreated: 0,
    paperFillsCreated: 0,
    ledgerEntriesCreated: 0,
  }),
) {
  return {
    environment: () => safeEnvironment,
    deploymentEnvironment: () => 'production',
    now: () => new Date('2026-08-10T14:15:00.000Z'),
    randomId: vi
      .fn()
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000010')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000011'),
    dispatch,
  }
}

describe('protected Supabase scheduler route', () => {
  it('rejects an invalid secret with exactly zero scheduler side effects', async () => {
    const deps = dependencies()
    const result = await handleSchedulerPost(request('wrong-secret'), deps)

    expect(result.status).toBe(401)
    expect(await result.json()).toEqual({ error: 'unauthorized' })
    expect(deps.dispatch).not.toHaveBeenCalled()
    expect(result.headers.get('cache-control')).toContain('no-store')
  })

  it('makes Preview an unconditional no-op', async () => {
    const deps = {
      ...dependencies(),
      deploymentEnvironment: () => 'preview',
    }
    const result = await handleSchedulerPost(request(), deps)

    expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({
      status: 'skipped',
      reason: 'production_only',
      modelCalls: 0,
      paperOrdersCreated: 0,
      paperFillsCreated: 0,
    })
    expect(deps.dispatch).not.toHaveBeenCalled()
  })

  it('dispatches one authenticated, disabled-AI production envelope', async () => {
    const deps = dependencies()
    const result = await handleSchedulerPost(request(), deps)

    expect(result.status).toBe(200)
    expect(deps.dispatch).toHaveBeenCalledOnce()
    expect(await result.json()).toMatchObject({
      correlationId: '00000000-0000-4000-8000-000000000010',
      cycleId: '00000000-0000-4000-8000-000000000011',
      status: 'completed',
      cyclesClaimed: 1,
      modelCalls: 0,
      paperOrdersCreated: 0,
      paperFillsCreated: 0,
      ledgerEntriesCreated: 0,
    })
  })

  it.each([
    'AGENT_ENABLED',
    'PAID_MODEL_CALLS_ENABLED',
    'OPENAI_CANARY_ENABLED',
    'OPENAI_WEB_SEARCH_ENABLED',
    'SOL_ENABLED',
    'SOL_CHALLENGER_ENABLED',
    'SOL_LIVE_EXECUTION_ENABLED',
    'REAL_BROKER_ENABLED',
  ] as const)('fails closed when %s is enabled', async (flag) => {
    const deps = dependencies()
    deps.environment = () => ({ ...safeEnvironment, [flag]: true })
    const result = await handleSchedulerPost(request(), deps)

    expect(result.status).toBe(409)
    expect(deps.dispatch).not.toHaveBeenCalled()
  })
})
