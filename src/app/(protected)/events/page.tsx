import type { Metadata } from 'next'

import { EventsView } from '@/features/events/events-view'
import { mockRepository } from '@/lib/mock/repository'

export const metadata: Metadata = { title: 'Events' }
export default function EventsPage() {
  return <EventsView data={mockRepository.getEvents()} />
}
