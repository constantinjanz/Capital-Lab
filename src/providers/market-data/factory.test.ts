import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  alpacaConstructor: vi.fn(),
  getEnvironment: vi.fn(),
  mockConstructor: vi.fn(),
}))

vi.mock('@/lib/env/server', () => ({
  getServerEnvironment: mocks.getEnvironment,
}))
vi.mock('./alpaca', () => ({
  AlpacaMarketDataProvider: class {
    constructor(options: unknown) {
      mocks.alpacaConstructor(options)
    }
  },
}))
vi.mock('./mock', () => ({
  MockMarketDataProvider: class {
    constructor() {
      mocks.mockConstructor()
    }
  },
}))

import { createMarketDataProvider } from './factory'

describe('market data provider factory', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keeps mock mode credential-free', () => {
    mocks.getEnvironment.mockReturnValue({ MARKET_DATA_PROVIDER: 'mock' })

    expect(() => createMarketDataProvider()).not.toThrow()
    expect(mocks.mockConstructor).toHaveBeenCalledOnce()
    expect(mocks.alpacaConstructor).not.toHaveBeenCalled()
  })

  it.each([
    {},
    { ALPACA_API_KEY_ID: 'key-id' },
    { ALPACA_API_SECRET_KEY: 'secret-key' },
  ])(
    'fails closed before provider construction for incomplete credentials',
    (credentials) => {
      mocks.getEnvironment.mockReturnValue({
        MARKET_DATA_PROVIDER: 'alpaca',
        ALPACA_DATA_FEED: 'iex',
        ...credentials,
      })

      expect(() => createMarketDataProvider()).toThrow(
        'Alpaca Market Data credentials are not configured',
      )
      expect(mocks.alpacaConstructor).not.toHaveBeenCalled()
    },
  )

  it('constructs only the reviewed data adapter with a complete pair', () => {
    mocks.getEnvironment.mockReturnValue({
      MARKET_DATA_PROVIDER: 'alpaca',
      ALPACA_DATA_FEED: 'iex',
      ALPACA_API_KEY_ID: 'key-id',
      ALPACA_API_SECRET_KEY: 'secret-key',
    })

    expect(() => createMarketDataProvider()).not.toThrow()
    expect(mocks.alpacaConstructor).toHaveBeenCalledWith({
      keyId: 'key-id',
      secretKey: 'secret-key',
      feed: 'iex',
    })
  })
})
