import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getServerEnvironment, resetEnvironmentForTests } from './server'

const environmentKeys = [
  'MARKET_DATA_PROVIDER',
  'ALPACA_API_KEY_ID',
  'ALPACA_API_SECRET_KEY',
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
})
