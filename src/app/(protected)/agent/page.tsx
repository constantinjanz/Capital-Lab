import type { Metadata } from 'next'

import { AgentView } from '@/features/agent/agent-view'
import { mockRepository } from '@/lib/mock/repository'

export const metadata: Metadata = { title: 'Agent console' }
export default function AgentPage() {
  return <AgentView data={mockRepository.getAgent()} />
}
