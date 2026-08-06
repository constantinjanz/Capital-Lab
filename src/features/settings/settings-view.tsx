import {
  Check,
  EyeOff,
  LockKeyhole,
  ServerCog,
  ShieldCheck,
  X,
} from 'lucide-react'

import { DataModeNotice } from '@/components/ui/data-mode-notice'
import { PageHeader } from '@/components/ui/page-header'
import { Panel } from '@/components/ui/panel'
import { StatusPill } from '@/components/ui/status-pill'
import { TableShell } from '@/components/ui/table-shell'
import type { SettingsViewModel } from '@/lib/mock/types'

export function SettingsView({ data }: { data: SettingsViewModel }) {
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Safe defaults"
        title="Settings"
        description="Visible versioned defaults, providers, allowlists, routing caps, budget policy, flags, and prompt manifests."
        actions={<StatusPill tone="warning">Read-only mock</StatusPill>}
      />
      <DataModeNotice compact />
      <Panel
        eyebrow="Future experiments"
        title="Experiment defaults"
        action={<span className="as-of">Active runs remain immutable</span>}
      >
        <div className="configuration-grid">
          {data.defaults.map((item) => (
            <div className="configuration-item" key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <small>{item.detail}</small>
            </div>
          ))}
        </div>
      </Panel>
      <div className="dashboard-grid dashboard-grid--split">
        <Panel eyebrow="External adapters" title="Provider status">
          <div className="provider-list">
            {data.providers.map((provider) => (
              <article key={provider.name}>
                <span className="provider-list__icon">
                  <ServerCog size={17} aria-hidden="true" />
                </span>
                <div>
                  <strong>{provider.name}</strong>
                  <p>{provider.detail}</p>
                </div>
                <div>
                  <StatusPill
                    tone={
                      provider.state === 'Disabled' ? 'neutral' : 'positive'
                    }
                  >
                    {provider.state}
                  </StatusPill>
                  <small>{provider.mode}</small>
                </div>
              </article>
            ))}
          </div>
        </Panel>
        <Panel eyebrow="Secrets" title="Configuration visibility">
          <div className="secrets-block">
            <EyeOff size={22} aria-hidden="true" />
            <div>
              <strong>No secret values are displayed</strong>
              <p>
                Settings expose only configured/not-configured state. API keys,
                tokens, and credentials remain server-only.
              </p>
            </div>
          </div>
          <dl className="definition-list">
            <div>
              <dt>Supabase secret</dt>
              <dd>Not configured</dd>
            </div>
            <div>
              <dt>OpenAI API key</dt>
              <dd>Not configured</dd>
            </div>
            <div>
              <dt>Alpaca data key</dt>
              <dd>Not configured</dd>
            </div>
            <div>
              <dt>Broker trading key</dt>
              <dd className="text-positive">Unsupported by design</dd>
            </div>
          </dl>
        </Panel>
      </div>
      <Panel eyebrow="Untrusted input policy" title="Source allowlist">
        <TableShell caption="Allowed and blocked research sources">
          <thead>
            <tr>
              <th scope="col">Source</th>
              <th scope="col">Type</th>
              <th scope="col">Access</th>
              <th scope="col">Policy</th>
            </tr>
          </thead>
          <tbody>
            {data.sources.map((source) => (
              <tr key={source.name}>
                <td>
                  <strong>{source.name}</strong>
                </td>
                <td>{source.type}</td>
                <td>
                  <StatusPill tone={source.allowed ? 'positive' : 'negative'}>
                    {source.allowed ? (
                      <>
                        <Check size={13} aria-hidden="true" />
                        Allowed
                      </>
                    ) : (
                      <>
                        <X size={13} aria-hidden="true" />
                        Blocked
                      </>
                    )}
                  </StatusPill>
                </td>
                <td>{source.policy}</td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      </Panel>
      <div className="dashboard-grid dashboard-grid--split">
        <Panel eyebrow="Model router" title="Caps and roles">
          <div className="routing-list">
            {data.routing.map((route) => (
              <div key={route.model}>
                <span>
                  <strong>{route.model}</strong>
                  <small>{route.role}</small>
                </span>
                <span>
                  <strong>{route.cap}</strong>
                  <StatusPill tone={route.enabled ? 'positive' : 'neutral'}>
                    {route.enabled ? 'Enabled' : 'Disabled'}
                  </StatusPill>
                </span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel eyebrow="Cost controls" title="Budget policy">
          <div className="budget-policy">
            {data.budget.map((item) => (
              <div key={item.label}>
                <span>
                  {item.hard ? (
                    <LockKeyhole size={15} aria-hidden="true" />
                  ) : (
                    <ShieldCheck size={15} aria-hidden="true" />
                  )}
                  {item.label}
                </span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        </Panel>
      </div>
      <div className="dashboard-grid dashboard-grid--split">
        <Panel eyebrow="Runtime boundaries" title="Feature flags">
          <div className="flag-list">
            {data.flags.map((flag) => (
              <div key={flag.name}>
                <span
                  className={
                    flag.enabled ? 'flag-switch flag-switch--on' : 'flag-switch'
                  }
                  aria-hidden="true"
                >
                  <i />
                </span>
                <span>
                  <strong>{flag.name}</strong>
                  <small>{flag.detail}</small>
                </span>
                <StatusPill tone={flag.enabled ? 'positive' : 'neutral'}>
                  {flag.enabled ? 'On' : 'Off'}
                </StatusPill>
              </div>
            ))}
          </div>
        </Panel>
        <Panel eyebrow="Version control" title="Prompt manifest">
          <div className="prompt-list">
            {data.prompts.map((prompt) => (
              <div key={prompt.role}>
                <span>
                  <strong>{prompt.role}</strong>
                  <small>{prompt.updated}</small>
                </span>
                <code>{prompt.version}</code>
                <StatusPill
                  tone={prompt.status === 'Disabled' ? 'neutral' : 'info'}
                >
                  {prompt.status}
                </StatusPill>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  )
}
