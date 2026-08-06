import { createMarketDataProvider } from '@/providers/market-data/factory'

import { fifteenMinuteSlotKey, mockUsRegularSession } from './market-session'

export type MarketCycleResult = {
  status: 'completed' | 'skipped' | 'duplicate'
  slotKey: string
  reason?: string
  quotesIngested: number
  modelCalls: number
  paperOrdersCreated: number
}

const completedSlots = new Map<string, MarketCycleResult>()

export async function runMockSafeMarketCycle(
  at: Date,
  experimentId = 'mock-experiment-replay',
): Promise<MarketCycleResult> {
  const slotKey = fifteenMinuteSlotKey('market-cycle', experimentId, at)
  const previous = completedSlots.get(slotKey)
  if (previous) return { ...previous, status: 'duplicate' }

  const session = mockUsRegularSession(at)
  if (!session.eligible) {
    const result: MarketCycleResult = {
      status: 'skipped',
      slotKey,
      reason: session.reason,
      quotesIngested: 0,
      modelCalls: 0,
      paperOrdersCreated: 0,
    }
    completedSlots.set(slotKey, result)
    return result
  }

  const provider = createMarketDataProvider()
  const quotes = await provider.getLatestQuotes(
    ['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA'],
    at.toISOString(),
  )
  const result: MarketCycleResult = {
    status: 'completed',
    slotKey,
    quotesIngested: quotes.length,
    modelCalls: 0,
    paperOrdersCreated: 0,
    reason: 'agent_disabled_safe_default',
  }
  completedSlots.set(slotKey, result)
  return result
}
