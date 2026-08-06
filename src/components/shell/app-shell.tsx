import { FlaskConical, LogOut, ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import { Suspense, type ReactNode } from 'react'

import { signOut } from '@/lib/auth/actions'
import type { ShellViewModel } from '@/lib/mock/types'

import { StatusPill } from '../ui/status-pill'
import { EmergencyPauseButton } from './emergency-pause-button'
import { ExperimentSelector } from './experiment-selector'
import { MobileNav, SidebarNav } from './sidebar-nav'
import { StatusRail } from './status-rail'

export function AppShell({
  children,
  shell,
  owner,
}: {
  children: ReactNode
  shell: ShellViewModel
  owner: { displayName: string }
}) {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar">
        <Link
          href="/dashboard"
          className="brand"
          aria-label="Capital Lab dashboard"
        >
          <span className="brand__mark" aria-hidden="true">
            <FlaskConical size={19} />
          </span>
          <span>
            <strong>Capital Lab</strong>
            <small>Research OS</small>
          </span>
        </Link>
        <div className="paper-badge">
          <ShieldCheck size={14} aria-hidden="true" />
          PAPER TRADING ONLY
        </div>
        <Suspense
          fallback={<div className="nav-skeleton" aria-hidden="true" />}
        >
          <SidebarNav />
        </Suspense>
        <div className="sidebar__footer">
          <div className="owner-card">
            <span className="owner-card__avatar" aria-hidden="true">
              {shell.owner.initials}
            </span>
            <span>
              <strong>{owner.displayName}</strong>
              <small>Private owner</small>
            </span>
          </div>
          <form action={signOut}>
            <button type="submit" className="logout-link">
              <LogOut size={15} aria-hidden="true" />
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="topbar__mobile-brand">
            <span className="brand__mark" aria-hidden="true">
              <FlaskConical size={17} />
            </span>
            <strong>Capital Lab</strong>
          </div>
          <ExperimentSelector
            currentId={shell.currentExperiment.id}
            experiments={shell.experiments}
          />
          <div className="topbar__actions">
            <StatusPill tone="info" dot>
              {shell.currentExperiment.status}
            </StatusPill>
            <EmergencyPauseButton />
          </div>
        </header>
        <Suspense fallback={null}>
          <MobileNav />
        </Suspense>
        <StatusRail shell={shell} />
        <main id="main-content" className="main-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  )
}
