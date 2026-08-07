import { randomUUID } from 'node:crypto'

import type { Metadata } from 'next'

import {
  ExperimentsView,
  HostedExperimentsView,
} from '@/features/experiments/experiments-view'
import { requireOwner } from '@/lib/auth/require-owner'
import { mockRepository } from '@/lib/mock/repository'
import { readWorkspace } from '@/lib/supabase/workspace-read-repository'

export const metadata: Metadata = { title: 'Experiments' }

export default async function ExperimentsPage() {
  const identity = await requireOwner()
  if (identity.mode === 'mock') {
    return <ExperimentsView experiments={mockRepository.listExperiments()} />
  }
  const workspace = await readWorkspace(
    identity.mode,
    identity.id,
    identity.email,
  )
  if (workspace.source !== 'supabase') {
    throw new Error('Hosted experiments resolved the wrong data source')
  }
  return (
    <HostedExperimentsView
      experiments={workspace.experiments}
      draftOperationId={randomUUID()}
    />
  )
}
