import type { Metadata } from 'next'

import { HostedMarketsView } from '@/features/markets/hosted-markets-view'
import { MarketsView } from '@/features/markets/markets-view'
import { requireOwner } from '@/lib/auth/require-owner'
import { mockRepository } from '@/lib/mock/repository'
import { readHostedMarketSnapshot } from '@/lib/supabase/market-snapshot-read-repository'

export const metadata: Metadata = { title: 'Markets' }

export default async function MarketsPage() {
  const identity = await requireOwner()
  if (identity.mode === 'mock') {
    return <MarketsView data={mockRepository.getMarkets()} />
  }

  const snapshot = await readHostedMarketSnapshot(identity.id)
  return <HostedMarketsView snapshot={snapshot} />
}
