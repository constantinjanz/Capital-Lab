import type { Metadata } from 'next'

import { HostedMemoryView } from '@/features/memory/hosted-memory-view'
import type { HostedDecisionMemory } from '@/features/memory/hosted-decision-memory'
import { MemoryView } from '@/features/memory/memory-view'
import { requireOwner } from '@/lib/auth/require-owner'
import { mockRepository } from '@/lib/mock/repository'
import {
  decisionAtForHostedMemoryRead,
  readHostedDecisionMemory,
} from '@/lib/supabase/decision-memory-read-repository'

export const metadata: Metadata = { title: 'Memory' }

export default async function MemoryPage() {
  const identity = await requireOwner()
  if (identity.mode === 'mock') {
    return <MemoryView data={mockRepository.getMemory()} />
  }

  const decisionAt = decisionAtForHostedMemoryRead()
  let memory: HostedDecisionMemory | null = null
  try {
    memory = await readHostedDecisionMemory(identity.id, decisionAt)
  } catch {
    // The repository logs only a sanitized failure classification.
  }
  return <HostedMemoryView memory={memory} decisionAt={decisionAt} />
}
