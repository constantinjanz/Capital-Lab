import 'server-only'

import { getServerEnvironment } from '@/lib/env/server'

import { AlpacaMarketDataProvider } from './alpaca'
import { MockMarketDataProvider } from './mock'
import type { MarketDataProvider } from './types'

export function createMarketDataProvider(): MarketDataProvider {
  const environment = getServerEnvironment()
  if (environment.MARKET_DATA_PROVIDER === 'mock') {
    return new MockMarketDataProvider()
  }
  if (!environment.ALPACA_API_KEY_ID || !environment.ALPACA_API_SECRET_KEY) {
    throw new Error('Alpaca Market Data credentials are not configured')
  }
  return new AlpacaMarketDataProvider({
    keyId: environment.ALPACA_API_KEY_ID,
    secretKey: environment.ALPACA_API_SECRET_KEY,
    feed: environment.ALPACA_DATA_FEED,
  })
}
