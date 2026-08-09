import { afterEach, describe, expect, it } from 'vitest'

import { resetEnvironmentForTests } from '@/lib/env/server'

import { GET } from './route'

const keys = [
  'SCHEDULER_ENABLED',
  'AGENT_ENABLED',
  'PAID_MODEL_CALLS_ENABLED',
  'OPENAI_CANARY_ENABLED',
  'OPENAI_WEB_SEARCH_ENABLED',
  'SOL_ENABLED',
  'SOL_CHALLENGER_ENABLED',
  'SOL_LIVE_EXECUTION_ENABLED',
  'REAL_BROKER_ENABLED',
  'AUTONOMOUS_PAPER_EXECUTION_ENABLED',
  'MARKET_DATA_PROVIDER',
  'NEWS_PROVIDER',
  'AGENT_EXECUTION_MODE',
] as const

afterEach(() => {
  for (const key of keys) delete process.env[key]
  resetEnvironmentForTests()
})

describe('redacted health evidence', () => {
  it('proves every dangerous runtime path is disabled without infrastructure details', async () => {
    const response = GET()
    const body = await response.json()

    expect(body).toMatchObject({
      status: 'ok',
      paperTradingOnly: true,
      activationSafe: true,
      dataMode: 'mock-paper-only',
      controls: {
        schedulerDisabled: true,
        agentDisabled: true,
        paidModelsDisabled: true,
        canaryDisabled: true,
        webSearchDisabled: true,
        solChallengerDisabled: true,
        solExecutionDisabled: true,
        realBrokerDisabled: true,
      },
    })
    expect(JSON.stringify(body)).not.toMatch(
      /secret|token|authorization|deployment|database|project_ref/i,
    )
  })

  it('fails closed when a non-mock data mode is configured', async () => {
    process.env.MARKET_DATA_PROVIDER = 'alpaca'
    resetEnvironmentForTests()

    const body = await GET().json()
    expect(body).toMatchObject({
      status: 'restricted',
      activationSafe: false,
      dataMode: 'restricted-non-mock',
    })
    expect(JSON.stringify(body)).not.toContain('alpaca')
  })
})
