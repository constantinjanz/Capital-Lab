import { randomUUID } from 'node:crypto'

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { ExperimentDetailView } from '@/features/experiments/experiments-view'
import { HostedExperimentDetailView } from '@/features/experiments/hosted-experiment-detail-view'
import { requireOwner } from '@/lib/auth/require-owner'
import { mockRepository } from '@/lib/mock/repository'
import {
  readHostedExperimentDetail,
  readHostedExperimentStartReadiness,
} from '@/lib/supabase/experiment-detail-read-repository'
import { readHostedManualCycleState } from '@/lib/supabase/manual-cycle-repository'

export const metadata: Metadata = { title: 'Experiment' }

export default async function ExperimentPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const [{ id }, owner] = await Promise.all([params, requireOwner()])

  if (owner.mode === 'mock') {
    const experiment = mockRepository.getExperiment(id)
    if (!experiment) notFound()
    return <ExperimentDetailView experiment={experiment} />
  }

  const [experiment, startReadiness, manualCycleState] = await Promise.all([
    readHostedExperimentDetail(owner.id, id),
    readHostedExperimentStartReadiness(id),
    readHostedManualCycleState(id),
  ])
  if (!experiment) notFound()
  return (
    <HostedExperimentDetailView
      experiment={experiment}
      draftOperationId={randomUUID()}
      startReadiness={startReadiness}
      startOperationIds={{ replay: randomUUID(), shadow: randomUUID() }}
      manualCycleState={manualCycleState}
      manualCycleOperationId={randomUUID()}
      lifecycleOperationIds={{
        promote_live_paper: randomUUID(),
        pause: randomUUID(),
        resume: randomUUID(),
        complete: randomUUID(),
        clone: randomUUID(),
      }}
    />
  )
}
