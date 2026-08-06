import type { Metadata } from 'next'

import { ResearchView } from '@/features/research/research-view'
import { mockRepository } from '@/lib/mock/repository'

export const metadata: Metadata = { title: 'Research' }
export default function ResearchPage() {
  return <ResearchView data={mockRepository.getResearch()} />
}
