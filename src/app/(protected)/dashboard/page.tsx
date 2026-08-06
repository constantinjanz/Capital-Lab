import type { Metadata } from 'next'

import { DashboardView } from '@/features/dashboard/dashboard-view'
import { mockRepository } from '@/lib/mock/repository'

export const metadata: Metadata = { title: 'Dashboard' }

export default function DashboardPage() {
  return <DashboardView data={mockRepository.getDashboard()} />
}
