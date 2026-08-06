import { ArrowLeft, FlaskConical } from 'lucide-react'
import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="centered-state">
      <div className="not-found">
        <span>
          <FlaskConical size={24} aria-hidden="true" />
        </span>
        <p className="eyebrow">404 · Experiment boundary</p>
        <h1>Research state not found</h1>
        <p>
          The requested route or experiment is unavailable in the current owner
          workspace.
        </p>
        <Link className="button button--primary" href="/dashboard">
          <ArrowLeft size={15} aria-hidden="true" />
          Return to dashboard
        </Link>
      </div>
    </main>
  )
}
