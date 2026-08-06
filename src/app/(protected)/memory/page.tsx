import type { Metadata } from 'next'

import { MemoryView } from '@/features/memory/memory-view'
import { mockRepository } from '@/lib/mock/repository'

export const metadata: Metadata = { title: 'Memory' }
export default function MemoryPage() {
  return <MemoryView data={mockRepository.getMemory()} />
}
