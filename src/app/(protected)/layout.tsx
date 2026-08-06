import type { ReactNode } from 'react'

import { AppShell } from '@/components/shell/app-shell'
import { requireOwner } from '@/lib/auth/require-owner'
import { readWorkspace } from '@/lib/supabase/workspace-read-repository'

export default async function ProtectedLayout({
  children,
}: {
  children: ReactNode
}) {
  const identity = await requireOwner()
  const owner = {
    displayName: identity.mode === 'mock' ? 'Research Owner' : identity.email,
  }
  const workspace = await readWorkspace(
    identity.mode,
    identity.id,
    identity.email,
  )

  return (
    <AppShell owner={owner} shell={workspace.shell}>
      {children}
    </AppShell>
  )
}
