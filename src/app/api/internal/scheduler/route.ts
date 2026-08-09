import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'

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
const requestSchema = z
  .object({ job: z.enum(['market_dispatcher', 'reconciler']) })
  .strict()

const noStoreHeaders = {
  'Cache-Control': 'no-store, max-age=0',
  Pragma: 'no-cache',
}

type SchedulerRouteDependencies = {
  environment(): ServerEnvironment
  deploymentEnvironment(): string | undefined
  now(): Date
  randomId(): string
  dispatch(input: {
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

function noAiShadowConfiguration(environment: ServerEnvironment): boolean {
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
    !environment.REAL_BROKER_ENABLED
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

  const correlationId = dependencies.randomId()
  const cycleId = dependencies.randomId()
  const requestedAt = dependencies.now().toISOString()

  if (dependencies.deploymentEnvironment() !== 'production') {
    return response({
      correlationId,
      cycleId,
      status: 'skipped',
      reason: 'production_only',
      modelCalls: 0,
      paperOrdersCreated: 0,
      paperFillsCreated: 0,
      ledgerEntriesCreated: 0,
    })
  }
  if (!environment.SCHEDULER_ENABLED) {
    return response({
      correlationId,
      cycleId,
      status: 'skipped',
      reason: 'scheduler_disabled',
      modelCalls: 0,
      paperOrdersCreated: 0,
      paperFillsCreated: 0,
      ledgerEntriesCreated: 0,
    })
  }
  if (
    environment.SCHEDULER_PROVIDER !== 'supabase' ||
    !noAiShadowConfiguration(environment)
  ) {
    return response(
      {
        correlationId,
        cycleId,
        status: 'skipped',
        reason: 'unsafe_scheduler_configuration',
        modelCalls: 0,
        paperOrdersCreated: 0,
        paperFillsCreated: 0,
        ledgerEntriesCreated: 0,
      },
      409,
    )
  }

  try {
    const result = await dependencies.dispatch({
      job: parsed.job,
      correlationId,
      cycleId,
      requestedAt,
      signal: AbortSignal.timeout(INTERNAL_DEADLINE_MS),
    })
    log('info', 'Protected scheduler request completed', {
      correlationId,
      operation: `scheduler_${parsed.job}`,
      metadata: {
        status: result.status,
        modelCalls: result.modelCalls,
        paperOrders: result.paperOrdersCreated,
        paperFills: result.paperFillsCreated,
      },
    })
    return response({ correlationId, cycleId, ...result })
  } catch (error) {
    log('error', 'Protected scheduler result is unknown', {
      correlationId,
      operation: `scheduler_${parsed.job}`,
      errorClass: error instanceof Error ? error.name : 'UnknownThrownValue',
    })
    return response(
      {
        correlationId,
        cycleId,
        status: 'unknown',
        reason: 'scheduler_result_unknown',
        modelCalls: 0,
        paperOrdersCreated: 0,
        paperFillsCreated: 0,
        ledgerEntriesCreated: 0,
      },
      503,
    )
  }
}

const productionDependencies: SchedulerRouteDependencies = {
  environment: getServerEnvironment,
  deploymentEnvironment: () => process.env.VERCEL_ENV,
  now: () => new Date(),
  randomId: randomUUID,
  async dispatch(input) {
    const client = createSupabaseAdminClient()
    if (!client) throw new Error('Hosted scheduler client is unavailable')
    return runHostedSchedulerRequest(client, input)
  },
}

export async function POST(request: Request): Promise<Response> {
  return handleSchedulerPost(request, productionDependencies)
}
