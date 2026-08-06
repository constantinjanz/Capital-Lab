'use client'

import { ErrorPanel } from '@/components/ui/error-panel'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body className="global-error-body">
        <main className="centered-state">
          <ErrorPanel
            title="Capital Lab entered a safe state"
            description="The application shell failed before any operation could continue. No paper order or paid call was made."
            digest={error.digest}
            onRetry={reset}
          />
        </main>
      </body>
    </html>
  )
}
