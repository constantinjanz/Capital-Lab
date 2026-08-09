import type { Metadata } from 'next'

import { CostsView } from '@/features/costs/costs-view'
import { requireOwner } from '@/lib/auth/require-owner'
import { mockRepository } from '@/lib/mock/repository'
import { readHostedBudgetStatus } from '@/lib/supabase/budget-status-read-repository'
import { readHostedStorageStatus } from '@/lib/supabase/storage-status-read-repository'

export const metadata: Metadata = { title: 'Costs' }
export default async function CostsPage() {
  const identity = await requireOwner()
  const [storage, budget] =
    identity.mode === 'supabase'
      ? await Promise.all([
          readHostedStorageStatus().catch(() => ({
            available: false as const,
            reason: 'storage_monitor_unavailable',
          })),
          readHostedBudgetStatus().catch(() => ({
            available: false as const,
            reason: 'budget_monitor_unavailable',
          })),
        ])
      : [
          { available: false as const, reason: 'mock_mode' },
          { available: false as const, reason: 'mock_mode' },
        ]
  return (
    <CostsView
      data={mockRepository.getCosts()}
      storage={storage}
      budget={budget}
    />
  )
}
