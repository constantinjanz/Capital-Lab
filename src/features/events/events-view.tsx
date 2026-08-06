import {
  ArrowRight,
  Clock3,
  ExternalLink,
  FileCheck2,
  Fingerprint,
  RadioTower,
} from 'lucide-react'

import { DataModeNotice } from '@/components/ui/data-mode-notice'
import { PageHeader } from '@/components/ui/page-header'
import { Panel } from '@/components/ui/panel'
import { ProgressMeter } from '@/components/ui/progress-meter'
import { StatusPill } from '@/components/ui/status-pill'
import type { EventsViewModel } from '@/lib/mock/types'

export function EventsView({ data }: { data: EventsViewModel }) {
  const selected = data.selected

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Evidence pipeline"
        title="Events"
        description="Sanitized public information with source provenance, revision state, and available-to-agent timing."
        actions={
          <StatusPill tone="positive" dot>
            4 sources healthy
          </StatusPill>
        }
      />
      <DataModeNotice />
      <div className="filter-bar" role="group" aria-label="Event filters">
        {data.categories.map((category, index) => (
          <button
            key={category.name}
            className={
              index === 0 ? 'filter-chip filter-chip--active' : 'filter-chip'
            }
            type="button"
          >
            {category.name}
            <span>{category.count}</span>
          </button>
        ))}
      </div>
      <div className="event-layout">
        <Panel
          className="event-feed"
          eyebrow="Ranked by relevance"
          title="Point-in-time feed"
        >
          <div className="event-list">
            {data.events.map((event, index) => (
              <article
                className={
                  index === 0 ? 'event-card event-card--active' : 'event-card'
                }
                key={event.id}
              >
                <div className="event-card__meta">
                  <span>
                    {event.id} · {event.category}
                  </span>
                  <time>{event.at}</time>
                </div>
                <h3>{event.title}</h3>
                <p>{event.summary}</p>
                <div className="event-card__footer">
                  <span>{event.symbols.join(' · ')}</span>
                  <span>
                    {event.relevance}% relevance{' '}
                    <ArrowRight size={13} aria-hidden="true" />
                  </span>
                </div>
              </article>
            ))}
          </div>
        </Panel>
        <div className="event-detail-stack">
          <Panel
            eyebrow={`${selected.id} · ${selected.category}`}
            title={selected.title}
            action={
              <StatusPill tone="positive">
                {selected.quality} quality
              </StatusPill>
            }
          >
            <p className="lead-copy">{selected.summary}</p>
            <div className="relevance-block">
              <div>
                <span>Agent relevance</span>
                <strong>{selected.relevance}%</strong>
              </div>
              <ProgressMeter
                value={selected.relevance}
                label="Event relevance"
                tone="positive"
              />
            </div>
            <dl className="definition-list definition-list--roomy">
              <div>
                <dt>Source</dt>
                <dd>{selected.source}</dd>
              </div>
              <div>
                <dt>Linked instruments</dt>
                <dd>{selected.symbols.join(', ')}</dd>
              </div>
              <div>
                <dt>Timing</dt>
                <dd>{selected.timing}</dd>
              </div>
              <div>
                <dt>Revision state</dt>
                <dd>Original · no corrections available</dd>
              </div>
            </dl>
          </Panel>
          <Panel eyebrow="Trust boundary" title="Provenance and sanitization">
            <div className="principle-grid principle-grid--vertical">
              <div>
                <Fingerprint size={18} aria-hidden="true" />
                <span>
                  <strong>Content hash verified</strong>
                  <small className="mono">sha256:8f20…c41a</small>
                </span>
              </div>
              <div>
                <FileCheck2 size={18} aria-hidden="true" />
                <span>
                  <strong>External instructions removed</strong>
                  <small>
                    Source text is evidence only, never executable instruction.
                  </small>
                </span>
              </div>
              <div>
                <Clock3 size={18} aria-hidden="true" />
                <span>
                  <strong>Available at 14:34 UTC</strong>
                  <small>
                    Replay queries before this timestamp cannot retrieve the
                    event.
                  </small>
                </span>
              </div>
              <div>
                <RadioTower size={18} aria-hidden="true" />
                <span>
                  <strong>Synthetic provider</strong>
                  <small>
                    Deterministic fixture; no external URL was fetched.
                  </small>
                </span>
              </div>
            </div>
            <button className="button button--secondary" type="button" disabled>
              <ExternalLink size={14} aria-hidden="true" />
              No live source in mock mode
            </button>
          </Panel>
        </div>
      </div>
    </div>
  )
}
