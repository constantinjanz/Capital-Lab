import type { Metadata } from 'next'

import { SettingsView } from '@/features/settings/settings-view'
import { mockRepository } from '@/lib/mock/repository'

export const metadata: Metadata = { title: 'Settings' }
export default function SettingsPage() {
  return <SettingsView data={mockRepository.getSettings()} />
}
