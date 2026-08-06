import type { Metadata } from 'next'

import { ExperimentsView } from '@/features/experiments/experiments-view'
import { mockRepository } from '@/lib/mock/repository'

export const metadata: Metadata = { title: 'Experiments' }

export default function ExperimentsPage() {
  return <ExperimentsView experiments={mockRepository.listExperiments()} />
}
