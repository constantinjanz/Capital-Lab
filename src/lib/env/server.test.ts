import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getServerEnvironment, resetEnvironmentForTests } from './server'

const environmentKeys = [
  'MARKET_DATA_PROVIDER',
  'ALPACA_API_KEY_ID',
  'ALPACA_API_SECRET_KEY',
  'AGENT_ENABLED',
  'AGENT_EXECUTION_MODE',
  'PAID_MODEL_CALLS_ENABLED',
  'REAL_BROKER_ENABLED',
  'OPENAI_API_KEY',
  'SUPABASE_SECRET_KEY',
  'SCHEDULER_SHARED_SECRET',
  'SCHEDULER_PROVIDER',
  'SCHEDULER_ENABLED',
  'AUTONOMOUS_PAPER_EXECUTION_ENABLED',
  'OPENAI_CANARY_ENABLED',
  'OPENAI_WEB_SEARCH_ENABLED',
  'SOL_ENABLED',
  'SOL_CHALLENGER_ENABLED',
  'SOL_LIVE_EXECUTION_ENABLED',
  'DATA_MODE',
  'EXECUTION_MODE',
] as const

const originalValues = new Map<string, string | undefined>()

describe('server environment Alpaca readiness', () => {
  beforeEach(() => {
    for (const key of environmentKeys) {
      originalValues.set(key, process.env[key])
      delete process.env[key]
    }
    resetEnvironmentForTests()
  })

  afterEach(() => {
    for (const key of environmentKeys) {
      const value = originalValues.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    originalValues.clear()
    resetEnvironmentForTests()
  })

  it('allows staged Alpaca mode to report missing credentials safely', () => {
    process.env.MARKET_DATA_PROVIDER = 'alpaca'

    const environment = getServerEnvironment()
    expect(environment).toMatchObject({ MARKET_DATA_PROVIDER: 'alpaca' })
    expect(environment).not.toHaveProperty('ALPACA_API_KEY_ID')
    expect(environment).not.toHaveProperty('ALPACA_API_SECRET_KEY')
  })

  it.each([
    ['ALPACA_API_KEY_ID', 'key-id'],
    ['ALPACA_API_SECRET_KEY', 'secret-key'],
  ] as const)(
    'rejects a partial credential pair when only %s is set',
    (key, value) => {
      process.env.MARKET_DATA_PROVIDER = 'alpaca'
      process.env[key] = value

      expect(() => getServerEnvironment()).toThrow(
        'Both Alpaca Market Data credential values are required',
      )
    },
  )

  it('requires both server-only provider and database keys only when the agent is enabled', () => {
    process.env.AGENT_ENABLED = 'true'
    process.env.AGENT_EXECUTION_MODE = 'shadow'
    process.env.PAID_MODEL_CALLS_ENABLED = 'true'
    process.env.OPENAI_API_KEY = 'provider-key'

    expect(() => getServerEnvironment()).toThrow(
      'SUPABASE_SECRET_KEY is required only when AGENT_ENABLED=true',
    )

    process.env.SUPABASE_SECRET_KEY = 'server-only-database-key'
    resetEnvironmentForTests()

    expect(getServerEnvironment()).toMatchObject({
      AGENT_ENABLED: true,
      AGENT_EXECUTION_MODE: 'shadow',
      PAID_MODEL_CALLS_ENABLED: true,
      OPENAI_API_KEY: 'provider-key',
      SUPABASE_SECRET_KEY: 'server-only-database-key',
    })
  })

  it('keeps the database mutation key optional while the agent is disabled', () => {
    expect(getServerEnvironment()).toMatchObject({
      AGENT_ENABLED: false,
      AGENT_EXECUTION_MODE: 'mock',
      PAID_MODEL_CALLS_ENABLED: false,
      SCHEDULER_ENABLED: false,
      SCHEDULER_PROVIDER: 'supabase',
      REAL_BROKER_ENABLED: false,
      DATA_MODE: 'mock',
      EXECUTION_MODE: 'paper',
    })
  })

  it.each([
    ['DATA_MODE', 'hosted'],
    ['EXECUTION_MODE', 'live'],
  ] as const)('rejects an unreviewed observed %s', (key, value) => {
    process.env[key] = value

    expect(() => getServerEnvironment()).toThrow()
  })

  it('accepts the later Production no-AI scheduler state without an OpenAI key', () => {
    process.env.SCHEDULER_ENABLED = 'true'
    process.env.SCHEDULER_PROVIDER = 'supabase'
    process.env.SCHEDULER_SHARED_SECRET = 's'.repeat(48)
    process.env.SUPABASE_SECRET_KEY = 'server-only-database-key'

    expect(getServerEnvironment()).toMatchObject({
      SCHEDULER_ENABLED: true,
      SCHEDULER_PROVIDER: 'supabase',
      AGENT_ENABLED: false,
      PAID_MODEL_CALLS_ENABLED: false,
      OPENAI_CANARY_ENABLED: false,
    })
    expect(getServerEnvironment()).not.toHaveProperty('OPENAI_API_KEY')
  })

  it('rejects every permanently unsupported execution flag', () => {
    process.env.REAL_BROKER_ENABLED = 'true'

    expect(() => getServerEnvironment()).toThrow(
      'Real broker connectivity is permanently unsupported',
    )
  })
})
