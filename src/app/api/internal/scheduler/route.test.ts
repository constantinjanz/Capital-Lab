import { describe, expect, it, vi, type Mock } from 'vitest'

import type { ServerEnvironment } from '@/lib/env/server'

import {
  handleSchedulerPost,
  ZERO_SCHEDULER_EFFECTS,
  type SchedulerRouteDependencies,
} from './route'

const authDeploymentId = 'dpl_7Gw5ZMBpQA8h9GF832KGp7nwbuh3'
const runtimeDeploymentId = 'dpl_8Hx6ANcqBR9i0HG943LHq8oxcvi4'
const expectedProjectId = 'prj_pbCNwlmXZLeZprZpsRAfAAhPPXVR'
const expectedCommitSha = 'a'.repeat(40)
const identity = {
  environment: 'production',
  targetEnvironment: 'production',
  deploymentId: authDeploymentId,
  projectId: expectedProjectId,
  commitSha: expectedCommitSha,
  deploymentUrl: 'capital-auth-disabled.example.vercel.app',
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
  schema_version: 3,
  mode: 'auth_noop',
  deployment_role: 'auth_disabled',
  campaign_id: '00000000-0000-4000-8000-000000000001',
  correlation_id: '00000000-0000-4000-8000-000000000002',
  nonce: '00000000-0000-4000-8000-000000000003',
  request_id: '00000000-0000-4000-8000-000000000004',
  expected_deployment_id: authDeploymentId,
  expected_project_id: expectedProjectId,
  expected_commit_sha: expectedCommitSha,
} as const

const dryRunBody = {
  schema_version: 3,
  mode: 'dry_run',
  deployment_role: 'no_ai_runtime_enabled',
  campaign_id: '00000000-0000-4000-8000-000000000001',
  event_id: '00000000-0000-4000-8000-000000000005',
  correlation_id: '00000000-0000-4000-8000-000000000006',
  request_id: '00000000-0000-4000-8000-000000000007',
  cycle_id: '00000000-0000-4000-8000-000000000008',
  job: 'market_dispatcher',
  slot_number: 0,
  expected_deployment_id: runtimeDeploymentId,
  expected_project_id: expectedProjectId,
  expected_commit_sha: expectedCommitSha,
} as const

const runtimeConfigBody = {
  schema_version: 4,
  mode: 'runtime_config_noop',
  deployment_role: 'no_ai_runtime_enabled',
  campaign_id: '00000000-0000-4000-8000-000000000001',
  correlation_id: '00000000-0000-4000-8000-000000000009',
  nonce: '00000000-0000-4000-8000-000000000010',
  request_id: '00000000-0000-4000-8000-000000000011',
  expected_deployment_id: runtimeDeploymentId,
  expected_project_id: expectedProjectId,
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

type SchedulerDispatch = SchedulerRouteDependencies['dispatch']

function dependencies({
  runtime = false,
  dispatch,
}: {
  runtime?: boolean
  dispatch?: Mock<SchedulerDispatch>
} = {}): SchedulerRouteDependencies & { dispatch: Mock<SchedulerDispatch> } {
  const resolvedDispatch =
    dispatch ??
    vi.fn<SchedulerDispatch>().mockResolvedValue({
      status: 'completed',
      reason: 'no_ai_shadow_cycle_recorded',
      cyclesClaimed: 1,
      cyclesReconciled: 0,
      modelCalls: 0,
      budgetReservations: 0,
      paperOrdersCreated: 0,
      paperFillsCreated: 0,
      ledgerEntriesCreated: 0,
    })
  return {
    environment: () => ({
      ...safeEnvironment,
      SCHEDULER_ENABLED: runtime,
    }),
    deploymentIdentity: () => ({
      ...identity,
      deploymentId: runtime ? runtimeDeploymentId : authDeploymentId,
      deploymentUrl: runtime
        ? 'capital-runtime-enabled.example.vercel.app'
        : 'capital-auth-disabled.example.vercel.app',
    }),
    now: () => new Date('2026-08-10T14:15:00.000Z'),
    dispatch: resolvedDispatch,
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
      expect(await result.json()).toEqual({
        schema_version: 3,
        mode: 'auth_failure',
        error: 'unauthorized',
        classification: 'bearer_missing_or_invalid',
        scheduler_disabled: true,
        agent_disabled: true,
        counters: ZERO_SCHEDULER_EFFECTS,
      })
      expect(deps.dispatch).not.toHaveBeenCalled()
      expect(result.headers.get('cache-control')).toContain('no-store')
    },
  )

  it('returns an exact authenticated one-shot no-op envelope', async () => {
    const deps = dependencies()
    const result = await handleSchedulerPost(request(), deps)

    expect(result.status).toBe(200)
    expect(await result.json()).toEqual({
      schema_version: 3,
      mode: 'auth_noop',
      deployment_role: 'auth_disabled',
      campaign_id: authBody.campaign_id,
      correlation_id: authBody.correlation_id,
      nonce: authBody.nonce,
      request_id: authBody.request_id,
      environment: 'production',
      deployment_id: authDeploymentId,
      project_id: expectedProjectId,
      commit_sha: expectedCommitSha,
      status: 'authenticated_noop',
      terminal_reason: 'auth_noop_verified',
      scheduler_disabled: true,
      agent_disabled: true,
      counters: ZERO_SCHEDULER_EFFECTS,
    })
    expect(deps.dispatch).not.toHaveBeenCalled()
  })

  it('attests the actual enabled no-AI Runtime deployment without dispatching', async () => {
    const deps = dependencies({ runtime: true })
    const result = await handleSchedulerPost(request(runtimeConfigBody), deps)

    expect(result.status).toBe(200)
    expect(await result.json()).toEqual({
      schema_version: 4,
      mode: 'runtime_config_noop',
      deployment_role: 'no_ai_runtime_enabled',
      campaign_id: runtimeConfigBody.campaign_id,
      correlation_id: runtimeConfigBody.correlation_id,
      nonce: runtimeConfigBody.nonce,
      request_id: runtimeConfigBody.request_id,
      observed_at: '2026-08-10T14:15:00.000Z',
      vercel_environment: 'production',
      vercel_target_environment: 'production',
      deployment_id: runtimeDeploymentId,
      project_id: expectedProjectId,
      commit_sha: expectedCommitSha,
      deployment_url: 'https://capital-runtime-enabled.example.vercel.app',
      status: 'runtime_config_observed',
      terminal_reason: 'runtime_config_attested',
      scheduler_disabled: false,
      agent_disabled: true,
      runtime: {
        scheduler_enabled: true,
        scheduler_provider: 'supabase',
        agent_enabled: false,
        agent_execution_mode: 'mock',
        autonomous_paper_execution_enabled: false,
        paid_model_calls_enabled: false,
        openai_canary_enabled: false,
        openai_web_search_enabled: false,
        sol_enabled: false,
        sol_challenger_enabled: false,
        sol_live_execution_enabled: false,
        real_broker_enabled: false,
        market_data_provider: 'mock',
        news_provider: 'mock',
        openai_api_key_present: false,
        data_mode: 'mock',
        execution_mode: 'paper',
      },
      counters: ZERO_SCHEDULER_EFFECTS,
    })
    expect(deps.dispatch).not.toHaveBeenCalled()
    expect(result.headers.get('cache-control')).toBe('no-store')
  })

  it.each([
    [
      'desired role cannot override observed scheduler=false',
      { SCHEDULER_ENABLED: false },
      {},
    ],
    ['agent flag', { AGENT_ENABLED: true }, {}],
    ['paid models', { PAID_MODEL_CALLS_ENABLED: true }, {}],
    ['OpenAI key presence', { OPENAI_API_KEY: 'fixture-only-never-used' }, {}],
    ['wrong environment', {}, { environment: 'preview' }],
    ['wrong target environment', {}, { targetEnvironment: 'preview' }],
    ['wrong deployment', {}, { deploymentId: authDeploymentId }],
    ['wrong project', {}, { projectId: 'prj_00000000000000000000' }],
    ['wrong commit', {}, { commitSha: 'b'.repeat(40) }],
    ['ambiguous deployment URL', {}, { deploymentUrl: 'evil.example:443' }],
  ])(
    'fails the Runtime configuration attestation for %s',
    async (_label, environmentDrift, identityDrift) => {
      const base = dependencies({ runtime: true })
      const deps = {
        ...base,
        environment: () => ({ ...base.environment(), ...environmentDrift }),
        deploymentIdentity: () => ({
          ...base.deploymentIdentity(),
          ...identityDrift,
        }),
      }
      const result = await handleSchedulerPost(request(runtimeConfigBody), deps)

      expect([409]).toContain(result.status)
      expect(deps.dispatch).not.toHaveBeenCalled()
    },
  )

  it('rejects caller-asserted Runtime flags as an extra request field', async () => {
    const deps = dependencies({ runtime: true })
    const body = { ...runtimeConfigBody, expected_scheduler_enabled: true }
    const result = await handleSchedulerPost(request(body), deps)
    expect(result.status).toBe(400)
    expect(deps.dispatch).not.toHaveBeenCalled()
  })

  it.each([
    { environment: 'preview' },
    { deploymentId: 'dpl_00000000000000000000' },
    { commitSha: 'b'.repeat(40) },
    { projectId: 'prj_00000000000000000000' },
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
    const deps = dependencies({ runtime: true })
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
        schema_version: 3,
        mode: 'dry_run',
        deployment_role: 'no_ai_runtime_enabled',
        campaign_id: dryRunBody.campaign_id,
        event_id: dryRunBody.event_id,
        request_id: dryRunBody.request_id,
        deployment_id: runtimeDeploymentId,
        project_id: expectedProjectId,
        commit_sha: expectedCommitSha,
        status: 'completed',
        terminal_reason: 'no_ai_shadow_cycle_recorded',
        counters: ZERO_SCHEDULER_EFFECTS,
      }),
    )
  })

  it('rejects a Runtime request that reuses the Auth deployment identity', async () => {
    const deps = dependencies()
    const result = await handleSchedulerPost(request(dryRunBody), deps)

    expect(result.status).toBe(409)
    expect(deps.dispatch).not.toHaveBeenCalled()
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
    const base = dependencies({ runtime: true })
    const deps = {
      ...base,
      environment: () => ({ ...base.environment(), [flag]: true }),
    }
    const result = await handleSchedulerPost(request(dryRunBody), deps)

    expect(result.status).toBe(409)
    expect(deps.dispatch).not.toHaveBeenCalled()
  })

  it('preserves an unknown outcome on the original request identity', async () => {
    const deps = dependencies({
      runtime: true,
      dispatch: vi.fn().mockRejectedValue(new Error('timeout')),
    })
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
