import 'server-only'

import { z } from 'zod'

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true')

const decimalCurrency = z
  .string()
  .regex(/^\d+(?:\.\d{1,8})?$/, 'Must be a non-negative decimal string')

const serverEnvironmentSchema = z
  .object({
    OWNER_EMAIL: z.email().optional(),
    OWNER_BOOTSTRAP_ENABLED: booleanString,
    SUPABASE_SECRET_KEY: z.string().min(1).optional(),
    OPENAI_API_KEY: z.string().min(1).optional(),
    ALPACA_API_KEY_ID: z.string().min(1).optional(),
    ALPACA_API_SECRET_KEY: z.string().min(1).optional(),
    ALPACA_DATA_FEED: z.enum(['iex', 'sip', 'delayed_sip']).default('iex'),
    SCHEDULER_SHARED_SECRET: z.string().min(32).optional(),
    SCHEDULER_PROVIDER: z
      .enum(['manual', 'vercel', 'supabase'])
      .default('supabase'),
    SCHEDULER_ENABLED: booleanString,
    AGENT_ENABLED: booleanString,
    AGENT_EXECUTION_MODE: z
      .enum(['mock', 'shadow', 'live_paper'])
      .default('mock'),
    AUTONOMOUS_PAPER_EXECUTION_ENABLED: booleanString,
    PAID_MODEL_CALLS_ENABLED: booleanString,
    OPENAI_CANARY_ENABLED: booleanString,
    SOL_ENABLED: booleanString,
    SOL_CHALLENGER_ENABLED: booleanString,
    SOL_LIVE_EXECUTION_ENABLED: booleanString,
    OPENAI_WEB_SEARCH_ENABLED: booleanString,
    REAL_BROKER_ENABLED: booleanString,
    MARKET_DATA_PROVIDER: z.enum(['mock', 'alpaca']).default('mock'),
    NEWS_PROVIDER: z.enum(['mock', 'alpaca', 'public']).default('mock'),
    EMBEDDING_PROVIDER: z.enum(['mock', 'supabase']).default('mock'),
    APP_BASE_URL: z.url().default('http://localhost:3000'),
    AI_LIFETIME_HARD_LIMIT_USD: decimalCurrency.default('50.00'),
    AI_EXPERIMENT_HARD_LIMIT_USD: decimalCurrency.default('30.00'),
    AI_MONTHLY_SOFT_TARGET_USD: decimalCurrency.default('8.00'),
    AI_MONTHLY_HARD_LIMIT_USD: decimalCurrency.default('10.00'),
    AI_TRADING_DAY_SOFT_TARGET_USD: decimalCurrency.default('0.25'),
    AI_TRADING_DAY_HARD_LIMIT_USD: decimalCurrency.default('0.40'),
    BUDGET_TIMEZONE: z.literal('America/New_York').default('America/New_York'),
  })
  .superRefine((value, context) => {
    if (value.OWNER_BOOTSTRAP_ENABLED && !value.OWNER_EMAIL) {
      context.addIssue({
        code: 'custom',
        message: 'OWNER_EMAIL is required when owner bootstrap is enabled',
      })
    }
    const alpacaCredentials = [
      value.ALPACA_API_KEY_ID,
      value.ALPACA_API_SECRET_KEY,
    ]
    if (alpacaCredentials.some(Boolean) && !alpacaCredentials.every(Boolean)) {
      context.addIssue({
        code: 'custom',
        message: 'Both Alpaca Market Data credential values are required',
      })
    }
    if (value.SCHEDULER_ENABLED && value.SCHEDULER_PROVIDER !== 'supabase') {
      context.addIssue({
        code: 'custom',
        message: 'Supabase is the only supported remote scheduler authority',
      })
    }
    if (value.SCHEDULER_ENABLED && !value.SCHEDULER_SHARED_SECRET) {
      context.addIssue({
        code: 'custom',
        message:
          'A server-only scheduler shared secret of at least 32 characters is required',
      })
    }
    if (value.SCHEDULER_ENABLED && !value.SUPABASE_SECRET_KEY) {
      context.addIssue({
        code: 'custom',
        message: 'SUPABASE_SECRET_KEY is required for remote scheduling',
      })
    }
    if (
      value.AGENT_ENABLED &&
      (!value.PAID_MODEL_CALLS_ENABLED ||
        value.AGENT_EXECUTION_MODE !== 'shadow')
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Agent activation requires paid calls and the reviewed shadow execution mode',
      })
    }
    if (
      (value.AGENT_ENABLED || value.OPENAI_CANARY_ENABLED) &&
      !value.OPENAI_API_KEY
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'OPENAI_API_KEY is required only for an explicitly enabled agent or paid canary',
      })
    }
    if (value.AGENT_ENABLED && !value.SUPABASE_SECRET_KEY) {
      context.addIssue({
        code: 'custom',
        message: 'SUPABASE_SECRET_KEY is required only when AGENT_ENABLED=true',
      })
    }
    if (
      value.PAID_MODEL_CALLS_ENABLED &&
      !value.AGENT_ENABLED &&
      !value.OPENAI_CANARY_ENABLED
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Paid model calls require an explicitly enabled agent or paid canary',
      })
    }
    if (
      value.OPENAI_CANARY_ENABLED &&
      (value.AGENT_ENABLED ||
        value.AUTONOMOUS_PAPER_EXECUTION_ENABLED ||
        value.OPENAI_WEB_SEARCH_ENABLED)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'The paid canary requires agent, autonomous execution, and web search to remain disabled',
      })
    }
    if (value.OPENAI_CANARY_ENABLED && !value.SUPABASE_SECRET_KEY) {
      context.addIssue({
        code: 'custom',
        message:
          'SUPABASE_SECRET_KEY is required for the canary budget ledger and one-shot lock',
      })
    }
    if (
      value.SOL_CHALLENGER_ENABLED &&
      (!value.SOL_ENABLED ||
        !value.AGENT_ENABLED ||
        !value.PAID_MODEL_CALLS_ENABLED)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'The Sol challenger requires explicit Sol, agent, and paid-call activation',
      })
    }
    if (value.AUTONOMOUS_PAPER_EXECUTION_ENABLED) {
      context.addIssue({
        code: 'custom',
        message: 'Autonomous paper execution is unavailable in this release',
      })
    }
    if (value.SOL_LIVE_EXECUTION_ENABLED) {
      context.addIssue({
        code: 'custom',
        message: 'Sol live execution is permanently unsupported',
      })
    }
    if (value.REAL_BROKER_ENABLED) {
      context.addIssue({
        code: 'custom',
        message: 'Real broker connectivity is permanently unsupported',
      })
    }
  })

export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>

let cachedEnvironment: ServerEnvironment | undefined

export function getServerEnvironment(): ServerEnvironment {
  cachedEnvironment ??= serverEnvironmentSchema.parse(process.env)
  return cachedEnvironment
}

export function resetEnvironmentForTests(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Environment cache may only be reset in tests')
  }
  cachedEnvironment = undefined
}
