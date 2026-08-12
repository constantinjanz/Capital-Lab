import { createHash, timingSafeEqual } from 'node:crypto'

import { z } from 'zod'

import { getServerEnvironment, type ServerEnvironment } from '@/lib/env/server'
import { log } from '@/lib/logging/logger'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import {
  runHostedSchedulerRequest,
  type HostedSchedulerJob,
  type HostedSchedulerRequestResult,
} from '@/lib/supabase/scheduler-runtime-repository'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const INTERNAL_DEADLINE_MS = 110_000
const uuid = z.uuid()
const deploymentId = z.string().regex(/^dpl_[A-Za-z0-9]{20,64}$/)
const projectId = z.string().regex(/^prj_[A-Za-z0-9]{20,64}$/)
const commitSha = z.string().regex(/^[0-9a-f]{40}$/)
const identityFields = {
  schema_version: z.literal(3),
  campaign_id: uuid,
  correlation_id: uuid,
  request_id: uuid,
  expected_deployment_id: deploymentId,
  expected_project_id: projectId,
  expected_commit_sha: commitSha,
}
const authNoopRequestSchema = z
  .object({
    ...identityFields,
    mode: z.literal('auth_noop'),
    deployment_role: z.literal('auth_disabled'),
    nonce: uuid,
  })
  .strict()
const runtimeConfigNoopRequestSchema = z
  .object({
    ...identityFields,
    schema_version: z.literal(4),
    mode: z.literal('runtime_config_noop'),
    deployment_role: z.literal('no_ai_runtime_enabled'),
    nonce: uuid,
  })
  .strict()
const dryRunRequestSchema = z
  .object({
    ...identityFields,
    mode: z.literal('dry_run'),
    deployment_role: z.literal('no_ai_runtime_enabled'),
    event_id: uuid,
    cycle_id: uuid,
    job: z.enum(['market_dispatcher', 'reconciler']),
    slot_number: z.number().int().min(0).max(25),
  })
  .strict()
const requestSchema = z.discriminatedUnion('mode', [
  authNoopRequestSchema,
  runtimeConfigNoopRequestSchema,
  dryRunRequestSchema,
])

const noStoreHeaders = {
  'Cache-Control': 'no-store',
  Pragma: 'no-cache',
}

export const ZERO_SCHEDULER_EFFECTS = Object.freeze({
  provider_requests: 0,
  market_data_requests: 0,
  news_requests: 0,
  web_search_requests: 0,
  model_calls: 0,
  budget_reservations: 0,
  agent_runs: 0,
  agent_decisions: 0,
  agent_proposals: 0,
  orders: 0,
  fills: 0,
  position_mutations: 0,
  ledger_entries: 0,
  portfolio_mutations: 0,
  canary_runs: 0,
  broker_requests: 0,
  sol_executions: 0,
})

type DeploymentIdentity = {
  environment: string | undefined
  targetEnvironment: string | undefined
  deploymentId: string | undefined
  projectId: string | undefined
  commitSha: string | undefined
  deploymentUrl: string | undefined
}

export type SchedulerRouteDependencies = {
  environment(): ServerEnvironment
  deploymentIdentity(): DeploymentIdentity
  now(): Date
  dispatch(input: {
    campaignId: string
    eventId: string
    requestId: string
    job: HostedSchedulerJob
    correlationId: string
    cycleId: string
    requestedAt: string
    signal: AbortSignal
  }): Promise<HostedSchedulerRequestResult>
}

function secureBearerMatches(
  authorization: string | null,
  expectedSecret: string | undefined,
): boolean {
  if (!authorization || !expectedSecret) return false
  const expected = createHash('sha256')
    .update(`Bearer ${expectedSecret}`, 'utf8')
    .digest()
  const received = createHash('sha256').update(authorization, 'utf8').digest()
  return timingSafeEqual(received, expected)
}

function response(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status, headers: noStoreHeaders })
}

function allDangerousRuntimePathsDisabled(
  environment: ServerEnvironment,
): boolean {
  return (
    !environment.AGENT_ENABLED &&
    environment.AGENT_EXECUTION_MODE === 'mock' &&
    !environment.AUTONOMOUS_PAPER_EXECUTION_ENABLED &&
    !environment.PAID_MODEL_CALLS_ENABLED &&
    !environment.OPENAI_CANARY_ENABLED &&
    !environment.OPENAI_WEB_SEARCH_ENABLED &&
    !environment.SOL_ENABLED &&
    !environment.SOL_CHALLENGER_ENABLED &&
    !environment.SOL_LIVE_EXECUTION_ENABLED &&
    !environment.REAL_BROKER_ENABLED &&
    environment.MARKET_DATA_PROVIDER === 'mock' &&
    environment.NEWS_PROVIDER === 'mock'
  )
}

function identityMatches(
  actual: DeploymentIdentity,
  expected: {
    expected_deployment_id: string
    expected_project_id: string
    expected_commit_sha: string
  },
): boolean {
  return (
    actual.environment === 'production' &&
    actual.targetEnvironment === 'production' &&
    actual.deploymentId === expected.expected_deployment_id &&
    actual.projectId === expected.expected_project_id &&
    actual.commitSha === expected.expected_commit_sha
  )
}

function exactDeploymentOrigin(value: string | undefined): string | null {
  if (
    !value ||
    value.includes('/') ||
    value.includes('@') ||
    value.includes(':')
  ) {
    return null
  }
  try {
    const parsed = new URL(`https://${value}`)
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash ||
      !parsed.hostname.endsWith('.vercel.app')
    ) {
      return null
    }
    return parsed.origin
  } catch {
    return null
  }
}

export function observedRuntimeConfiguration(environment: ServerEnvironment) {
  return Object.freeze({
    scheduler_enabled: environment.SCHEDULER_ENABLED,
    scheduler_provider: environment.SCHEDULER_PROVIDER,
    agent_enabled: environment.AGENT_ENABLED,
    agent_execution_mode: environment.AGENT_EXECUTION_MODE,
    autonomous_paper_execution_enabled:
      environment.AUTONOMOUS_PAPER_EXECUTION_ENABLED,
    paid_model_calls_enabled: environment.PAID_MODEL_CALLS_ENABLED,
    openai_canary_enabled: environment.OPENAI_CANARY_ENABLED,
    openai_web_search_enabled: environment.OPENAI_WEB_SEARCH_ENABLED,
    sol_enabled: environment.SOL_ENABLED,
    sol_challenger_enabled: environment.SOL_CHALLENGER_ENABLED,
    sol_live_execution_enabled: environment.SOL_LIVE_EXECUTION_ENABLED,
    real_broker_enabled: environment.REAL_BROKER_ENABLED,
    market_data_provider: environment.MARKET_DATA_PROVIDER,
    news_provider: environment.NEWS_PROVIDER,
    openai_api_key_present: Boolean(environment.OPENAI_API_KEY),
    data_mode: environment.DATA_MODE,
    execution_mode: environment.EXECUTION_MODE,
  })
}

function runtimeConfigurationIsExactNoAi(
  observed: ReturnType<typeof observedRuntimeConfiguration>,
): boolean {
  return (
    observed.scheduler_enabled &&
    observed.scheduler_provider === 'supabase' &&
    !observed.agent_enabled &&
    observed.agent_execution_mode === 'mock' &&
    !observed.autonomous_paper_execution_enabled &&
    !observed.paid_model_calls_enabled &&
    !observed.openai_canary_enabled &&
    !observed.openai_web_search_enabled &&
    !observed.sol_enabled &&
    !observed.sol_challenger_enabled &&
    !observed.sol_live_execution_enabled &&
    !observed.real_broker_enabled &&
    observed.market_data_provider === 'mock' &&
    observed.news_provider === 'mock' &&
    !observed.openai_api_key_present &&
    observed.data_mode === 'mock' &&
    observed.execution_mode === 'paper'
  )
}

export async function handleSchedulerPost(
  request: Request,
  dependencies: SchedulerRouteDependencies,
): Promise<Response> {
  let environment: ServerEnvironment
  try {
    environment = dependencies.environment()
  } catch {
    return response({ error: 'scheduler_configuration_unavailable' }, 503)
  }

  // Authentication intentionally precedes parsing. An unauthenticated caller
  // cannot use body-shape or deployment-identity differences as an oracle.
  if (
    !secureBearerMatches(
      request.headers.get('authorization'),
      environment.SCHEDULER_SHARED_SECRET,
    )
  ) {
    return response(
      {
        schema_version: 3,
        mode: 'auth_failure',
        error: 'unauthorized',
        classification: 'bearer_missing_or_invalid',
        scheduler_disabled: !environment.SCHEDULER_ENABLED,
        agent_disabled: !environment.AGENT_ENABLED,
        counters: ZERO_SCHEDULER_EFFECTS,
      },
      401,
    )
  }

  let parsed: z.infer<typeof requestSchema>
  try {
    parsed = requestSchema.parse(await request.json())
  } catch {
    return response({ error: 'invalid_request' }, 400)
  }

  const identity = dependencies.deploymentIdentity()
  if (!identityMatches(identity, parsed)) {
    return response(
      {
        error: 'production_identity_mismatch',
        scheduler_disabled: !environment.SCHEDULER_ENABLED,
        agent_disabled: !environment.AGENT_ENABLED,
        counters: ZERO_SCHEDULER_EFFECTS,
      },
      409,
    )
  }

  if (parsed.mode === 'auth_noop') {
    if (
      environment.SCHEDULER_ENABLED ||
      !allDangerousRuntimePathsDisabled(environment)
    ) {
      return response(
        {
          error: 'auth_noop_requires_disabled_runtime',
          scheduler_disabled: !environment.SCHEDULER_ENABLED,
          agent_disabled: !environment.AGENT_ENABLED,
          counters: ZERO_SCHEDULER_EFFECTS,
        },
        409,
      )
    }
    return response({
      schema_version: 3,
      mode: 'auth_noop',
      deployment_role: parsed.deployment_role,
      campaign_id: parsed.campaign_id,
      correlation_id: parsed.correlation_id,
      nonce: parsed.nonce,
      request_id: parsed.request_id,
      environment: 'production',
      deployment_id: identity.deploymentId,
      project_id: identity.projectId,
      commit_sha: identity.commitSha,
      status: 'authenticated_noop',
      terminal_reason: 'auth_noop_verified',
      scheduler_disabled: true,
      agent_disabled: true,
      counters: ZERO_SCHEDULER_EFFECTS,
    })
  }

  if (parsed.mode === 'runtime_config_noop') {
    const runtime = observedRuntimeConfiguration(environment)
    const deploymentOrigin = exactDeploymentOrigin(identity.deploymentUrl)
    if (!deploymentOrigin || !runtimeConfigurationIsExactNoAi(runtime)) {
      return response(
        {
          error: 'runtime_config_attestation_failed_closed',
          scheduler_disabled: !environment.SCHEDULER_ENABLED,
          agent_disabled: !environment.AGENT_ENABLED,
          counters: ZERO_SCHEDULER_EFFECTS,
        },
        409,
      )
    }
    return response({
      schema_version: 4,
      mode: 'runtime_config_noop',
      deployment_role: parsed.deployment_role,
      campaign_id: parsed.campaign_id,
      correlation_id: parsed.correlation_id,
      nonce: parsed.nonce,
      request_id: parsed.request_id,
      observed_at: dependencies.now().toISOString(),
      vercel_environment: identity.environment,
      vercel_target_environment: identity.targetEnvironment,
      deployment_id: identity.deploymentId,
      project_id: identity.projectId,
      commit_sha: identity.commitSha,
      deployment_url: deploymentOrigin,
      status: 'runtime_config_observed',
      terminal_reason: 'runtime_config_attested',
      scheduler_disabled: false,
      agent_disabled: true,
      runtime,
      counters: ZERO_SCHEDULER_EFFECTS,
    })
  }

  if (
    !environment.SCHEDULER_ENABLED ||
    environment.SCHEDULER_PROVIDER !== 'supabase' ||
    !allDangerousRuntimePathsDisabled(environment)
  ) {
    return response(
      {
        error: 'unsafe_scheduler_configuration',
        scheduler_disabled: !environment.SCHEDULER_ENABLED,
        agent_disabled: !environment.AGENT_ENABLED,
        counters: ZERO_SCHEDULER_EFFECTS,
      },
      409,
    )
  }

  const requestedAt = dependencies.now().toISOString()
  try {
    const result = await dependencies.dispatch({
      campaignId: parsed.campaign_id,
      eventId: parsed.event_id,
      requestId: parsed.request_id,
      job: parsed.job,
      correlationId: parsed.correlation_id,
      cycleId: parsed.cycle_id,
      requestedAt,
      signal: AbortSignal.timeout(INTERNAL_DEADLINE_MS),
    })
    log('info', 'Protected scheduler request completed', {
      correlationId: parsed.correlation_id,
      operation: `scheduler_${parsed.job}`,
      metadata: {
        status: result.status,
        modelCalls: result.modelCalls,
        paperOrders: result.paperOrdersCreated,
        paperFills: result.paperFillsCreated,
      },
    })
    return response({
      schema_version: 3,
      mode: 'dry_run',
      deployment_role: parsed.deployment_role,
      campaign_id: parsed.campaign_id,
      event_id: parsed.event_id,
      correlation_id: parsed.correlation_id,
      request_id: parsed.request_id,
      cycle_id: parsed.cycle_id,
      job: parsed.job,
      slot_number: parsed.slot_number,
      environment: 'production',
      deployment_id: identity.deploymentId,
      project_id: identity.projectId,
      commit_sha: identity.commitSha,
      status: result.status,
      terminal_reason: result.reason,
      scheduler_disabled: false,
      agent_disabled: true,
      cycles_claimed: result.cyclesClaimed,
      cycles_reconciled: result.cyclesReconciled,
      counters: {
        ...ZERO_SCHEDULER_EFFECTS,
        model_calls: result.modelCalls,
        budget_reservations: result.budgetReservations,
        orders: result.paperOrdersCreated,
        fills: result.paperFillsCreated,
        ledger_entries: result.ledgerEntriesCreated,
      },
    })
  } catch (error) {
    log('error', 'Protected scheduler result is unknown', {
      correlationId: parsed.correlation_id,
      operation: `scheduler_${parsed.job}`,
      errorClass: error instanceof Error ? error.name : 'UnknownThrownValue',
    })
    return response(
      {
        schema_version: 3,
        mode: 'dry_run',
        deployment_role: parsed.deployment_role,
        campaign_id: parsed.campaign_id,
        event_id: parsed.event_id,
        correlation_id: parsed.correlation_id,
        request_id: parsed.request_id,
        cycle_id: parsed.cycle_id,
        job: parsed.job,
        slot_number: parsed.slot_number,
        environment: 'production',
        deployment_id: identity.deploymentId,
        project_id: identity.projectId,
        commit_sha: identity.commitSha,
        status: 'unknown',
        terminal_reason: 'scheduler_result_unknown',
        scheduler_disabled: false,
        agent_disabled: true,
        cycles_claimed: 0,
        cycles_reconciled: 0,
        counters: ZERO_SCHEDULER_EFFECTS,
      },
      503,
    )
  }
}

const productionDependencies: SchedulerRouteDependencies = {
  environment: getServerEnvironment,
  deploymentIdentity: () => ({
    environment: process.env.VERCEL_ENV,
    targetEnvironment: process.env.VERCEL_TARGET_ENV,
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID,
    projectId: process.env.VERCEL_PROJECT_ID,
    commitSha: process.env.VERCEL_GIT_COMMIT_SHA,
    deploymentUrl: process.env.VERCEL_URL,
  }),
  now: () => new Date(),
  async dispatch(input) {
    const client = createSupabaseAdminClient()
    if (!client) throw new Error('Hosted scheduler client is unavailable')
    return runHostedSchedulerRequest(client, input)
  },
}

export async function POST(request: Request): Promise<Response> {
  return handleSchedulerPost(request, productionDependencies)
}
