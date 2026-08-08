import type { Metadata } from 'next'

import { HostedMemoryView } from '@/features/memory/hosted-memory-view'
import type { HostedDecisionMemory } from '@/features/memory/hosted-decision-memory'
import type {
  HostedLearningSnapshot,
  HostedPatternLifecycleStatus,
} from '@/features/memory/hosted-learning-snapshot'
import type { HostedPatternReviewOperationIds } from '@/features/memory/hosted-pattern-review-controls'
import { MemoryView } from '@/features/memory/memory-view'
import { requireOwner } from '@/lib/auth/require-owner'
import { mockRepository } from '@/lib/mock/repository'
import {
  decisionAtForHostedMemoryRead,
  readHostedDecisionMemory,
} from '@/lib/supabase/decision-memory-read-repository'
import { readHostedLearningSnapshot } from '@/lib/supabase/learning-snapshot-read-repository'

export const metadata: Metadata = { title: 'Memory' }

function patternReviewOperationIdsFor(
  status: HostedPatternLifecycleStatus,
): HostedPatternReviewOperationIds {
  switch (status) {
    case 'proposed':
      return {
        start_shadow: crypto.randomUUID(),
        reject: crypto.randomUUID(),
      }
    case 'shadow':
      return {
        mark_eligible: crypto.randomUUID(),
        reject: crypto.randomUUID(),
        retire: crypto.randomUUID(),
      }
    case 'eligible':
      return { reject: crypto.randomUUID(), retire: crypto.randomUUID() }
    case 'active':
      return { retire: crypto.randomUUID() }
    case 'rejected':
    case 'retired':
      return {}
  }
}

export default async function MemoryPage() {
  const identity = await requireOwner()
  if (identity.mode === 'mock') {
    return <MemoryView data={mockRepository.getMemory()} />
  }

  const decisionAt = decisionAtForHostedMemoryRead()
  const [memory, learning] = await Promise.all([
    readHostedDecisionMemory(identity.id, decisionAt).catch(
      (): HostedDecisionMemory | null => null,
    ),
    readHostedLearningSnapshot(identity.id, decisionAt).catch(
      (): HostedLearningSnapshot | null => null,
    ),
  ])
  const patternReviewOperationIds: Record<
    string,
    HostedPatternReviewOperationIds
  > = Object.fromEntries(
    (learning?.patterns ?? []).map((pattern) => [
      pattern.id,
      patternReviewOperationIdsFor(pattern.lifecycleStatus),
    ]),
  )

  return (
    <HostedMemoryView
      memory={memory}
      learning={learning}
      decisionAt={decisionAt}
      patternReviewOperationIds={patternReviewOperationIds}
    />
  )
}
