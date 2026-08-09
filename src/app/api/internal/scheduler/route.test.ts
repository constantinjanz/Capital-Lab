import { describe, expect, it, vi } from 'vitest'

import type { ServerEnvironment } from '@/lib/env/server'

import { handleSchedulerPost, ZERO_SCHEDULER_EFFECTS } from './route'

const expectedDeploymentId = 'dpl_7Gw5ZMBpQA8h9GF832KGp7nwbuh3'
const expectedCommitSha = 'a'.repeat(40)
const identity = {
  environment: 'production',
  deploymentId: expectedDeploymentId,
  commitSha: expectedCommitSha,
}
const safeEnvironment = {
  SCHEDULER_SHARED_SECRET: 's'.repeat(48),
  SCHEDULER_ENABLED: false,
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
  MARKET_DATA_PROVIDER: 'mock',
  NEWS_PROVIDER: 'mock',
} as ServerEnvironment

const authBody = {
  schema_version: 2,
  mode: 'auth_noop',
  campaign_id: '00000000-0000-4000-8000-000000000001',
  correlation_id: '00000000-0000-4000-8000-000000000002',
  nonce: '00000000-0000-4000-8000-000000000003',
  request_id: '00000000-0000-4000-8000-000000000004',
  expected_deployment_id: expectedDeploymentId,
  expected_commit_sha: expectedCommitSha,
} as const

const dryRunBody = {
  schema_version: 2,
  mode: 'dry_run',
  campaign_id: '00000000-0000-4000-8000-000000000001',
  event_id: '00000000-0000-4000-8000-000000000005',
  correlation_id: '00000000-0000-4000-8000-000000000006',
  request_id: '00000000-0000-4000-8000-000000000007',
  cycle_id: '00000000-0000-4000-8000-000000000008',
  job: 'market_dispatcher',
  slot_number: 0,
  expected_deployment_id: expectedDeploymentId,
  expected_commit_sha: expectedCommitSha,
} as const

function request(
  body: Record<string, unknown> = authBody,
  secret = safeEnvironment.SCHEDULER_SHARED_SECRET,
) {
  return new Request('https://capital-lab.example/api/internal/scheduler', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

function dependencies(
  dispatch = vi.fn().mockResolvedValue({
    status: 'completed',
    reason: 'no_ai_shadow_cycle_recorded',
    cyclesClaimed: 1,
    cyclesReconciled: 0,
    modelCalls: 0,
    budgetReservations: 0,
    paperOrdersCreated: 0,
    paperFillsCreated: 0,
    ledgerEntriesCreated: 0,
  }),
) {
  return {
    environment: () => safeEnvironment,
    deploymentIdentity: () => identity,
    now: () => new Date('2026-08-10T14:15:00.000Z'),
    dispatch,
  }
}

describe('protected Supabase scheduler route', () => {
  it.each([undefined, 'wrong-secret'])(
    'rejects a missing or invalid bearer with exactly zero side effects',
    async (secret) => {
      const deps = dependencies()
      const source = request(authBody, secret ?? 'placeholder')
      const headers = new Headers(source.headers)
      if (secret === undefined) headers.delete('authorization')
      const result = await handleSchedulerPost(
        new Request(source, { headers }),
        deps,
      )

      expect(result.status).toBe(401)
      expect(await result.json()).toEqual({ error: 'unauthorized' })
      expect(deps.dispatch).not.toHaveBeenCalled()
      expect(result.headers.get('cache-control')).toContain('no-store')
    },
  )

  it('returns an exact authenticated one-shot no-op envelope', async () => {
    const deps = dependencies()
    const result = await handleSchedulerPost(request(), deps)

    expect(result.status).toBe(200)
    expect(await result.json()).toEqual({
      schema_version: 2,
      mode: 'auth_noop',
      campaign_id: authBody.campaign_id,
      correlation_id: authBody.correlation_id,
      nonce: authBody.nonce,
      request_id: authBody.request_id,
      environment: 'production',
      deployment_id: expectedDeploymentId,
      commit_sha: expectedCommitSha,
      status: 'authenticated_noop',
      terminal_reason: 'auth_noop_verified',
      scheduler_disabled: true,
      agent_disabled: true,
      counters: ZERO_SCHEDULER_EFFECTS,
    })
    expect(deps.dispatch).not.toHaveBeenCalled()
  })

  it.each([
    { environment: 'preview' },
    { deploymentId: 'dpl_00000000000000000000' },
    { commitSha: 'b'.repeat(40) },
  ])(
    'rejects deployment identity drift without a 2xx fallback',
    async (drift) => {
      const deps = {
        ...dependencies(),
        deploymentIdentity: () => ({ ...identity, ...drift }),
      }
      const result = await handleSchedulerPost(request(), deps)

      expect(result.status).toBe(409)
      expect(await result.json()).toMatchObject({
        error: 'production_identity_mismatch',
        counters: ZERO_SCHEDULER_EFFECTS,
      })
      expect(deps.dispatch).not.toHaveBeenCalled()
    },
  )

  it('rejects unknown request fields before any dispatch', async () => {
    const deps = dependencies()
    const result = await handleSchedulerPost(
      request({ ...authBody, authorization: 'must-not-be-accepted' }),
      deps,
    )

    expect(result.status).toBe(400)
    expect(deps.dispatch).not.toHaveBeenCalled()
  })

  it('dispatches one identity-bound disabled-AI production envelope', async () => {
    const deps = dependencies()
    deps.environment = () => ({ ...safeEnvironment, SCHEDULER_ENABLED: true })
    const result = await handleSchedulerPost(request(dryRunBody), deps)

    expect(result.status).toBe(200)
    expect(deps.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        job: 'market_dispatcher',
        correlationId: dryRunBody.correlation_id,
        cycleId: dryRunBody.cycle_id,
      }),
    )
    expect(await result.json()).toEqual(
      expect.objectContaining({
        schema_version: 2,
        mode: 'dry_run',
        campaign_id: dryRunBody.campaign_id,
        event_id: dryRunBody.event_id,
        request_id: dryRunBody.request_id,
        deployment_id: expectedDeploymentId,
        commit_sha: expectedCommitSha,
        status: 'completed',
        terminal_reason: 'no_ai_shadow_cycle_recorded',
        counters: ZERO_SCHEDULER_EFFECTS,
      }),
    )
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
    deps.environment = () => ({
      ...safeEnvironment,
      SCHEDULER_ENABLED: true,
      [flag]: true,
    })
    const result = await handleSchedulerPost(request(dryRunBody), deps)

    expect(result.status).toBe(409)
    expect(deps.dispatch).not.toHaveBeenCalled()
  })

  it('preserves an unknown outcome on the original request identity', async () => {
    const deps = dependencies(vi.fn().mockRejectedValue(new Error('timeout')))
    deps.environment = () => ({ ...safeEnvironment, SCHEDULER_ENABLED: true })
    const result = await handleSchedulerPost(request(dryRunBody), deps)

    expect(result.status).toBe(503)
    expect(await result.json()).toMatchObject({
      status: 'unknown',
      campaign_id: dryRunBody.campaign_id,
      correlation_id: dryRunBody.correlation_id,
      request_id: dryRunBody.request_id,
      counters: ZERO_SCHEDULER_EFFECTS,
    })
  })
})
