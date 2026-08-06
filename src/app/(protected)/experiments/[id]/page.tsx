import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { ExperimentDetailView } from '@/features/experiments/experiments-view'
import { HostedExperimentDetailView } from '@/features/experiments/hosted-experiment-detail-view'
import { requireOwner } from '@/lib/auth/require-owner'
import { mockRepository } from '@/lib/mock/repository'
import { readHostedExperimentDetail } from '@/lib/supabase/experiment-detail-read-repository'

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

  const experiment = await readHostedExperimentDetail(owner.id, id)
  if (!experiment) notFound()
  return <HostedExperimentDetailView experiment={experiment} />
}
