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
    OPENAI_API_KEY: z.string().min(1).optional(),
    ALPACA_API_KEY_ID: z.string().min(1).optional(),
    ALPACA_API_SECRET_KEY: z.string().min(1).optional(),
    ALPACA_DATA_FEED: z.enum(['iex', 'sip', 'delayed_sip']).default('iex'),
    CRON_SECRET: z.string().min(16).optional(),
    SCHEDULER_PROVIDER: z
      .enum(['manual', 'vercel', 'supabase'])
      .default('manual'),
    AGENT_ENABLED: booleanString,
    AGENT_EXECUTION_MODE: z.enum(['shadow', 'live_paper']).default('shadow'),
    SOL_ENABLED: booleanString,
    OPENAI_WEB_SEARCH_ENABLED: booleanString,
    MARKET_DATA_PROVIDER: z.enum(['mock', 'alpaca']).default('mock'),
    NEWS_PROVIDER: z.enum(['mock', 'alpaca', 'public']).default('mock'),
    EMBEDDING_PROVIDER: z.enum(['mock', 'supabase']).default('mock'),
    APP_BASE_URL: z.url().default('http://localhost:3000'),
    AI_LIFETIME_HARD_LIMIT_USD: decimalCurrency.default('50.00'),
    AI_MONTHLY_SOFT_TARGET_USD: decimalCurrency.default('6.30'),
    AI_MONTHLY_HARD_LIMIT_USD: decimalCurrency.default('10.00'),
    AI_TRADING_DAY_HARD_LIMIT_USD: decimalCurrency.default('0.30'),
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
    if (
      value.MARKET_DATA_PROVIDER === 'alpaca' &&
      !alpacaCredentials.every(Boolean)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Alpaca mode requires data-only API credentials',
      })
    }
    if (value.SCHEDULER_PROVIDER !== 'manual' && !value.CRON_SECRET) {
      context.addIssue({
        code: 'custom',
        message: 'A CRON_SECRET of at least 16 characters is required for cron',
      })
    }
    if (value.AGENT_ENABLED && !value.OPENAI_API_KEY) {
      context.addIssue({
        code: 'custom',
        message: 'OPENAI_API_KEY is required only when AGENT_ENABLED=true',
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
