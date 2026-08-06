'use client'

import { useRouter } from 'next/navigation'

export function ExperimentSelector({
  currentId,
  experiments,
}: {
  currentId: string | null
  experiments: Array<{ id: string; name: string; status: string }>
}) {
  const router = useRouter()

  return (
    <label className="experiment-selector">
      <span>Current experiment</span>
      <select
        value={currentId ?? ''}
        disabled={!currentId}
        onChange={(event) => router.push(`/experiments/${event.target.value}`)}
        aria-label="Select current experiment"
      >
        {!currentId ? <option value="">No experiment</option> : null}
        {experiments.map((experiment) => (
          <option value={experiment.id} key={experiment.id}>
            {experiment.name} · {experiment.status}
          </option>
        ))}
      </select>
    </label>
  )
}
