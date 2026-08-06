import type { Metadata } from 'next'

import {
  DashboardView,
  HostedDashboardView,
} from '@/features/dashboard/dashboard-view'
import { requireOwner } from '@/lib/auth/require-owner'
import { mockRepository } from '@/lib/mock/repository'
import { readWorkspace } from '@/lib/supabase/workspace-read-repository'

export const metadata: Metadata = { title: 'Dashboard' }

export default async function DashboardPage() {
  const identity = await requireOwner()
  if (identity.mode === 'mock') {
    return <DashboardView data={mockRepository.getDashboard()} />
  }
  const workspace = await readWorkspace(
    identity.mode,
    identity.id,
    identity.email,
  )
  if (workspace.source !== 'supabase') {
    throw new Error('Hosted dashboard resolved the wrong data source')
  }
  return <HostedDashboardView workspace={workspace} />
}
