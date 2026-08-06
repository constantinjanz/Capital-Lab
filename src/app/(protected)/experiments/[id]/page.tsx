import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { ExperimentDetailView } from '@/features/experiments/experiments-view'
import { mockRepository } from '@/lib/mock/repository'

export const metadata: Metadata = { title: 'Experiment' }

export default async function ExperimentPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const experiment = mockRepository.getExperiment(id)
  if (!experiment) notFound()
  return <ExperimentDetailView experiment={experiment} />
}
