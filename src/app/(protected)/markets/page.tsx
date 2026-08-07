import { randomUUID } from 'node:crypto'

import type { Metadata } from 'next'

import { deriveHostedMarketIngestionReadiness } from '@/features/markets/hosted-market-ingestion'
import type { HostedMarketIngestionReadiness } from '@/features/markets/hosted-market-ingestion'
import { HostedMarketsView } from '@/features/markets/hosted-markets-view'
import { MarketsView } from '@/features/markets/markets-view'
import { requireOwner } from '@/lib/auth/require-owner'
import { getServerEnvironment } from '@/lib/env/server'
import { mockRepository } from '@/lib/mock/repository'
import { readHostedMarketSnapshot } from '@/lib/supabase/market-snapshot-read-repository'

export const metadata: Metadata = { title: 'Markets' }

const MINUTE_MS = 60 * 1_000
const MAX_INGESTION_WINDOW_MS = 24 * 60 * MINUTE_MS

function previousCompletedMinuteWindow(now: Date): {
  windowStart: string
  windowEnd: string
} {
  const windowEndMs = Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS
  return {
    windowStart: new Date(windowEndMs - MAX_INGESTION_WINDOW_MS).toISOString(),
    windowEnd: new Date(windowEndMs).toISOString(),
  }
}

function hostedMarketIngestionReadiness(): HostedMarketIngestionReadiness {
  try {
    return deriveHostedMarketIngestionReadiness(getServerEnvironment())
  } catch {
    return {
      ready: false,
      code: 'environment_invalid',
      message:
        'The server-side market data environment is invalid. Source deactivation remains available.',
    }
  }
}

export default async function MarketsPage() {
  const identity = await requireOwner()
  if (identity.mode === 'mock') {
    return <MarketsView data={mockRepository.getMarkets()} />
  }

  const snapshot = await readHostedMarketSnapshot(identity.id)
  const ingestionReadiness = hostedMarketIngestionReadiness()
  const ingestionWindow = previousCompletedMinuteWindow(new Date())
  const sourceLifecycleOperationId = randomUUID()
  const ingestionOperationId = randomUUID()
  return (
    <HostedMarketsView
      snapshot={snapshot}
      configurationOperationId={randomUUID()}
      sourceLifecycleOperationId={sourceLifecycleOperationId}
      ingestionOperationId={ingestionOperationId}
      ingestionReadiness={ingestionReadiness}
      ingestionWindow={ingestionWindow}
    />
  )
}
