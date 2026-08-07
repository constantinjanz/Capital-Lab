import { z } from 'zod'

const canonicalUuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)

export const HOSTED_ALPACA_SYMBOLS = [
  'SPY',
  'QQQ',
  'AAPL',
  'MSFT',
  'NVDA',
] as const

export const HOSTED_INGESTION_FAILURE_CLASSES = [
  'timeout',
  'network_error',
  'http_unauthorized',
  'http_rate_limited',
  'http_server_error',
  'invalid_response',
  'persistence_rejected',
] as const

export type HostedIngestionFailureClass =
  (typeof HOSTED_INGESTION_FAILURE_CLASSES)[number]

const sourceLifecycleFormSchema = z.object({
  operationId: z.uuid('Source lifecycle operation is invalid'),
  enabled: z.enum(['true', 'false']).transform((value) => value === 'true'),
})

const ingestionFormSchema = z
  .object({
    operationId: z.uuid('Ingestion operation is invalid'),
    windowStart: z.iso.datetime(),
    windowEnd: z.iso.datetime(),
  })
  .superRefine((value, context) => {
    const start = Date.parse(value.windowStart)
    const end = Date.parse(value.windowEnd)
    if (start >= end || end - start > 24 * 60 * 60 * 1_000) {
      context.addIssue({
        code: 'custom',
        path: ['windowStart'],
        message:
          'Ingestion window must be positive and no longer than 24 hours',
      })
    }
  })

export type HostedSourceLifecycleInput = z.infer<
  typeof sourceLifecycleFormSchema
>

export type HostedMarketIngestionInput = z.infer<typeof ingestionFormSchema>

export type HostedMarketMutationActionState = {
  status:
    | 'idle'
    | 'success'
    | 'replayed'
    | 'provider-error'
    | 'blocked'
    | 'error'
    | 'unknown'
  message?: string
  summary?: {
    recordsSeen: number
    recordsInserted: number
    recordsDeduplicated: number
    availableAt: string
  }
}

export const initialHostedMarketMutationActionState: HostedMarketMutationActionState =
  { status: 'idle' }

export type HostedMarketIngestionReadiness = {
  ready: boolean
  code:
    | 'ready'
    | 'provider_disabled'
    | 'feed_not_reviewed'
    | 'credentials_missing'
    | 'environment_invalid'
    | 'scheduler_not_manual'
    | 'agent_enabled'
  message: string
}

export function deriveHostedMarketIngestionReadiness(environment: {
  MARKET_DATA_PROVIDER: 'mock' | 'alpaca'
  ALPACA_DATA_FEED: 'iex' | 'sip' | 'delayed_sip'
  ALPACA_API_KEY_ID?: string
  ALPACA_API_SECRET_KEY?: string
  SCHEDULER_PROVIDER: 'manual' | 'vercel' | 'supabase'
  AGENT_ENABLED: boolean
}): HostedMarketIngestionReadiness {
  if (environment.AGENT_ENABLED) {
    return {
      ready: false,
      code: 'agent_enabled',
      message: 'Disable the agent before manually ingesting provider data.',
    }
  }
  if (environment.SCHEDULER_PROVIDER !== 'manual') {
    return {
      ready: false,
      code: 'scheduler_not_manual',
      message: 'Manual ingestion requires the manual scheduler safety mode.',
    }
  }
  if (environment.MARKET_DATA_PROVIDER !== 'alpaca') {
    return {
      ready: false,
      code: 'provider_disabled',
      message:
        'The hosted Alpaca data adapter is not enabled in this deployment.',
    }
  }
  if (environment.ALPACA_DATA_FEED !== 'iex') {
    return {
      ready: false,
      code: 'feed_not_reviewed',
      message: 'Only the reviewed Alpaca IEX feed is allowed for this batch.',
    }
  }
  if (!environment.ALPACA_API_KEY_ID || !environment.ALPACA_API_SECRET_KEY) {
    return {
      ready: false,
      code: 'credentials_missing',
      message: 'Server-side Alpaca Market Data credentials are not configured.',
    }
  }
  return {
    ready: true,
    code: 'ready',
    message: 'Ready for one owner-triggered Alpaca IEX batch.',
  }
}

export function parseHostedSourceLifecycleForm(
  formData: FormData,
):
  | { success: true; data: HostedSourceLifecycleInput }
  | { success: false; state: HostedMarketMutationActionState } {
  const parsed = sourceLifecycleFormSchema.safeParse({
    operationId: formData.get('operationId'),
    enabled: formData.get('enabled'),
  })
  if (parsed.success) return parsed
  return {
    success: false,
    state: {
      status: 'error',
      message: 'Reload Markets to start a valid source lifecycle operation.',
    },
  }
}

export function parseHostedMarketIngestionForm(
  formData: FormData,
):
  | { success: true; data: HostedMarketIngestionInput }
  | { success: false; state: HostedMarketMutationActionState } {
  const parsed = ingestionFormSchema.safeParse({
    operationId: formData.get('operationId'),
    windowStart: formData.get('windowStart'),
    windowEnd: formData.get('windowEnd'),
  })
  if (parsed.success) return parsed
  return {
    success: false,
    state: {
      status: 'error',
      message: 'Reload Markets to start a valid bounded ingestion operation.',
    },
  }
}

export const hostedSourceLifecycleRowSchema = z
  .object({
    operation_id: canonicalUuid,
    source_id: canonicalUuid,
    policy_id: canonicalUuid,
    policy_version: z.number().int().positive(),
    enabled: z.boolean(),
    status: z.enum(['enabled', 'disabled']),
    replayed: z.boolean(),
    effective_at: z.iso.datetime(),
  })
  .strict()

export const hostedIngestionBeginRowSchema = z
  .object({
    operation_id: canonicalUuid,
    ingestion_run_id: canonicalUuid,
    source_id: canonicalUuid,
    status: z.enum(['running', 'completed', 'failed']),
    symbols: z.array(z.enum(HOSTED_ALPACA_SYMBOLS)).length(5),
    window_start: z.iso.datetime(),
    window_end: z.iso.datetime(),
    replayed: z.boolean(),
    started_at: z.iso.datetime(),
  })
  .strict()

const hostedIngestionCountersSchema = z.object({
  operation_id: canonicalUuid,
  ingestion_run_id: canonicalUuid,
  source_id: canonicalUuid,
  status: z.enum(['running', 'completed', 'failed', 'partial']),
  records_seen: z.number().int().nonnegative(),
  records_inserted: z.number().int().nonnegative(),
  records_reused: z.number().int().nonnegative(),
  records_rejected: z.number().int().nonnegative(),
})

export const hostedIngestionCommitRowSchema = hostedIngestionCountersSchema
  .extend({
    status: z.literal('completed'),
    replayed: z.boolean(),
    finished_at: z.iso.datetime(),
  })
  .strict()

export const hostedIngestionFailureRowSchema = hostedIngestionCountersSchema
  .extend({
    status: z.literal('failed'),
    error_class: z.enum(HOSTED_INGESTION_FAILURE_CLASSES),
    replayed: z.boolean(),
    finished_at: z.iso.datetime(),
  })
  .strict()

export const hostedIngestionLookupRowSchema = hostedIngestionCountersSchema
  .extend({
    started_at: z.iso.datetime(),
    finished_at: z.iso.datetime().nullable(),
    error_class: z.enum(HOSTED_INGESTION_FAILURE_CLASSES).nullable(),
  })
  .strict()

export function parseSingleRpcRow<T>(
  schema: z.ZodType<T>,
  data: unknown,
  expectedOperationId: string,
): T | null {
  const parsed = z.array(schema).length(1).safeParse(data)
  if (!parsed.success) return null
  const row = parsed.data[0]
  if (
    typeof row !== 'object' ||
    row === null ||
    !('operation_id' in row) ||
    typeof row.operation_id !== 'string' ||
    row.operation_id.toLowerCase() !== expectedOperationId.toLowerCase()
  ) {
    return null
  }
  return row
}
