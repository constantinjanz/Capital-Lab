import type { ReactNode } from 'react'

import { AppShell } from '@/components/shell/app-shell'
import { requireOwner } from '@/lib/auth/require-owner'
import { mockRepository } from '@/lib/mock/repository'

export default async function ProtectedLayout({
  children,
}: {
  children: ReactNode
}) {
  const identity = await requireOwner()
  const owner = {
    displayName: identity.mode === 'mock' ? 'Research Owner' : identity.email,
  }
  const shell = mockRepository.getShell()

  return (
    <AppShell owner={owner} shell={shell}>
      {children}
    </AppShell>
  )
}
