import type { Metadata } from 'next'

import { MarketsView } from '@/features/markets/markets-view'
import { mockRepository } from '@/lib/mock/repository'

export const metadata: Metadata = { title: 'Markets' }
export default function MarketsPage() {
  return <MarketsView data={mockRepository.getMarkets()} />
}
