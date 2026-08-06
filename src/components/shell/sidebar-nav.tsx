'use client'

import { clsx } from 'clsx'
import {
  Bot,
  BrainCircuit,
  CandlestickChart,
  CircleDollarSign,
  FlaskConical,
  LayoutDashboard,
  Newspaper,
  Settings,
  TestTubes,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const navigation = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/experiments', label: 'Experiments', icon: FlaskConical },
  { href: '/markets', label: 'Markets', icon: CandlestickChart },
  { href: '/events', label: 'Events', icon: Newspaper },
  { href: '/agent', label: 'Agent', icon: Bot },
  { href: '/memory', label: 'Memory', icon: BrainCircuit },
  { href: '/research', label: 'Research', icon: TestTubes },
  { href: '/costs', label: 'Costs', icon: CircleDollarSign },
  { href: '/settings', label: 'Settings', icon: Settings },
]

function NavigationLinks({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname()

  return (
    <nav
      className={mobile ? 'mobile-navigation__links' : 'sidebar-navigation'}
      aria-label="Primary navigation"
    >
      {navigation.map(({ href, label, icon: Icon }) => {
        const active =
          pathname === href ||
          (href === '/experiments' && pathname.startsWith('/experiments/'))
        return (
          <Link
            key={href}
            href={href}
            className={clsx('nav-link', active && 'nav-link--active')}
            aria-current={active ? 'page' : undefined}
          >
            <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
            <span>{label}</span>
          </Link>
        )
      })}
    </nav>
  )
}

export function SidebarNav() {
  return <NavigationLinks />
}

export function MobileNav() {
  return (
    <details className="mobile-navigation">
      <summary>Navigate</summary>
      <NavigationLinks mobile />
    </details>
  )
}
