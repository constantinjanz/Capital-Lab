import { FlaskConical, ShieldCheck } from 'lucide-react'
import type { Metadata } from 'next'

import { DataModeNotice } from '@/components/ui/data-mode-notice'
import { MockLoginForm } from '@/features/auth/mock-login-form'
import { OwnerLoginForm } from '@/features/auth/owner-login-form'
import { isSupabasePubliclyConfigured } from '@/lib/env/public'
import { getServerEnvironment } from '@/lib/env/server'

export const metadata: Metadata = { title: 'Owner login' }

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>
}) {
  const liveAuth = isSupabasePubliclyConfigured()
  const bootstrapEnabled = liveAuth
    ? getServerEnvironment().OWNER_BOOTSTRAP_ENABLED
    : false
  const { reason } = await searchParams
  return (
    <main className="login-page">
      <section
        className="login-brand-panel"
        aria-labelledby="login-product-title"
      >
        <div className="brand brand--login">
          <span className="brand__mark" aria-hidden="true">
            <FlaskConical size={20} />
          </span>
          <span>
            <strong>Capital Lab</strong>
            <small>Research OS</small>
          </span>
        </div>
        <div className="login-brand-panel__copy">
          <p className="eyebrow">Private experiment environment</p>
          <h1 id="login-product-title">
            Observe every decision.
            <br />
            Trust only the ledger.
          </h1>
          <p>
            A deterministic AI paper-trading laboratory with point-in-time
            evidence, hard risk limits, and explicit cost controls.
          </p>
        </div>
        <div className="login-principles">
          <span>
            <ShieldCheck size={16} aria-hidden="true" />
            No brokerage integration
          </span>
          <span>
            <ShieldCheck size={16} aria-hidden="true" />
            No paid calls in mock mode
          </span>
          <span>
            <ShieldCheck size={16} aria-hidden="true" />
            One authorized owner
          </span>
        </div>
      </section>
      <section className="login-card" aria-labelledby="login-heading">
        <div className="paper-badge">
          <ShieldCheck size={14} aria-hidden="true" />
          PAPER TRADING ONLY
        </div>
        <div>
          <p className="eyebrow">Owner access</p>
          <h2 id="login-heading">Open the laboratory</h2>
          <p>
            {liveAuth
              ? 'Use the authorized Supabase owner account.'
              : 'Use the deterministic local owner profile. Supabase Auth replaces this boundary when configured.'}
          </p>
        </div>
        {liveAuth ? null : <DataModeNotice compact />}
        {liveAuth ? (
          <OwnerLoginForm reason={reason} bootstrapEnabled={bootstrapEnabled} />
        ) : (
          <MockLoginForm />
        )}
        <p className="login-card__footer">
          Scientific and entertainment use only. Not financial advice.
        </p>
      </section>
    </main>
  )
}
