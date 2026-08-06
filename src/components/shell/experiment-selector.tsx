'use client'

import { useRouter } from 'next/navigation'

import type { ExperimentStatus } from '@/lib/mock/types'

export function ExperimentSelector({
  currentId,
  experiments,
}: {
  currentId: string
  experiments: Array<{ id: string; name: string; status: ExperimentStatus }>
}) {
  const router = useRouter()

  return (
    <label className="experiment-selector">
      <span>Current experiment</span>
      <select
        value={currentId}
        onChange={(event) => router.push(`/experiments/${event.target.value}`)}
        aria-label="Select current experiment"
      >
        {experiments.map((experiment) => (
          <option value={experiment.id} key={experiment.id}>
            {experiment.name} · {experiment.status}
          </option>
        ))}
      </select>
    </label>
  )
}
