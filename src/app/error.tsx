'use client'

import { ErrorPanel } from '@/components/ui/error-panel'

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <main className="centered-state">
      <ErrorPanel
        title="This research view could not load"
        description="No model call or simulated order was attempted. Retry the read or return to the dashboard."
        digest={error.digest}
        onRetry={reset}
      />
    </main>
  )
}
