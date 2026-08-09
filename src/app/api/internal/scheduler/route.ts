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
const commitSha = z.string().regex(/^[0-9a-f]{40}$/)
const identityFields = {
  schema_version: z.literal(2),
  campaign_id: uuid,
  correlation_id: uuid,
  request_id: uuid,
  expected_deployment_id: deploymentId,
  expected_commit_sha: commitSha,
}
const authNoopRequestSchema = z
  .object({
    ...identityFields,
    mode: z.literal('auth_noop'),
    nonce: uuid,
  })
  .strict()
const dryRunRequestSchema = z
  .object({
    ...identityFields,
    mode: z.literal('dry_run'),
    event_id: uuid,
    cycle_id: uuid,
    job: z.enum(['market_dispatcher', 'reconciler']),
    slot_number: z.number().int().min(0).max(25),
  })
  .strict()
const requestSchema = z.discriminatedUnion('mode', [
  authNoopRequestSchema,
  dryRunRequestSchema,
])

const noStoreHeaders = {
  'Cache-Control': 'no-store, max-age=0',
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
  canary_runs: 0,
  broker_requests: 0,
  sol_executions: 0,
})

type DeploymentIdentity = {
  environment: string | undefined
  deploymentId: string | undefined
  commitSha: string | undefined
}

type SchedulerRouteDependencies = {
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
    expected_commit_sha: string
  },
): boolean {
  return (
    actual.environment === 'production' &&
    actual.deploymentId === expected.expected_deployment_id &&
    actual.commitSha === expected.expected_commit_sha
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
    return response({ error: 'unauthorized' }, 401)
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
      schema_version: 2,
      mode: 'auth_noop',
      campaign_id: parsed.campaign_id,
      correlation_id: parsed.correlation_id,
      nonce: parsed.nonce,
      request_id: parsed.request_id,
      environment: 'production',
      deployment_id: identity.deploymentId,
      commit_sha: identity.commitSha,
      status: 'authenticated_noop',
      terminal_reason: 'auth_noop_verified',
      scheduler_disabled: true,
      agent_disabled: true,
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
      schema_version: 2,
      mode: 'dry_run',
      campaign_id: parsed.campaign_id,
      event_id: parsed.event_id,
      correlation_id: parsed.correlation_id,
      request_id: parsed.request_id,
      cycle_id: parsed.cycle_id,
      job: parsed.job,
      slot_number: parsed.slot_number,
      environment: 'production',
      deployment_id: identity.deploymentId,
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
        schema_version: 2,
        mode: 'dry_run',
        campaign_id: parsed.campaign_id,
        event_id: parsed.event_id,
        correlation_id: parsed.correlation_id,
        request_id: parsed.request_id,
        cycle_id: parsed.cycle_id,
        job: parsed.job,
        slot_number: parsed.slot_number,
        environment: 'production',
        deployment_id: identity.deploymentId,
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
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID,
    commitSha: process.env.VERCEL_GIT_COMMIT_SHA,
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
