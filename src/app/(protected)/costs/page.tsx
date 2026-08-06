import type { Metadata } from 'next'

import { CostsView } from '@/features/costs/costs-view'
import { mockRepository } from '@/lib/mock/repository'

export const metadata: Metadata = { title: 'Costs' }
export default function CostsPage() {
  return <CostsView data={mockRepository.getCosts()} />
}
