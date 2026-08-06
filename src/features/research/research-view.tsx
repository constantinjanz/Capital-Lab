import {
  Braces,
  FileText,
  FileUp,
  Fingerprint,
  ShieldCheck,
  TableProperties,
} from 'lucide-react'

import { DataModeNotice } from '@/components/ui/data-mode-notice'
import { PageHeader } from '@/components/ui/page-header'
import { Panel } from '@/components/ui/panel'
import { StatusPill } from '@/components/ui/status-pill'
import { TableShell } from '@/components/ui/table-shell'
import type { ResearchViewModel } from '@/lib/mock/types'

import { ResearchImporter } from './research-importer'

const formatIcons = [FileText, Braces, TableProperties]

export function ResearchView({ data }: { data: ResearchViewModel }) {
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Knowledge operations"
        title="Research library"
        description="Version, sanitize, preview, deduplicate, and index auditable research for point-in-time retrieval."
        actions={
          <StatusPill tone="positive" dot>
            Corpus 2026.08.01
          </StatusPill>
        }
      />
      <DataModeNotice />
      <section
        className="metric-grid metric-grid--four"
        aria-label="Research corpus summary"
      >
        {data.stats.map((stat) => (
          <article className="metric-card" key={stat.label}>
            <p>{stat.label}</p>
            <strong className="metric-card__value">{stat.value}</strong>
            <span className="metric-card__detail">{stat.detail}</span>
          </article>
        ))}
      </section>
      <div className="dashboard-grid dashboard-grid--split">
        <Panel
          eyebrow="Preview then commit"
          title="Import research"
          action={<FileUp size={17} aria-hidden="true" />}
        >
          <ResearchImporter />
        </Panel>
        <Panel eyebrow="Typed pipelines" title="Supported formats">
          <div className="format-list">
            {data.importFormats.map((format, index) => {
              const Icon = formatIcons[index]
              return (
                <div key={format.name}>
                  <span>
                    <Icon size={18} aria-hidden="true" />
                  </span>
                  <div>
                    <strong>
                      {format.name} <code>{format.extension}</code>
                    </strong>
                    <p>{format.description}</p>
                  </div>
                </div>
              )
            })}
          </div>
          <p className="safe-note">
            <Fingerprint size={14} aria-hidden="true" /> Every version receives
            a content hash, evidence IDs, availability time, and provenance.
          </p>
        </Panel>
      </div>
      <Panel
        eyebrow="Active corpus"
        title="Documents"
        action={<span className="as-of">All records synthetic</span>}
      >
        <TableShell caption="Research documents in the active synthetic corpus">
          <thead>
            <tr>
              <th scope="col">Document</th>
              <th scope="col">Format</th>
              <th scope="col">State</th>
              <th scope="col">Version</th>
              <th scope="col" className="numeric">
                Chunks
              </th>
              <th scope="col">Updated</th>
            </tr>
          </thead>
          <tbody>
            {data.documents.map((document) => (
              <tr key={document.title}>
                <td>
                  <div className="symbol-cell">
                    <strong>{document.title}</strong>
                    <span>
                      <StatusPill tone="warning">Synthetic fixture</StatusPill>
                    </span>
                  </div>
                </td>
                <td>{document.type}</td>
                <td>
                  <StatusPill tone="positive">{document.state}</StatusPill>
                </td>
                <td className="mono">{document.version}</td>
                <td className="numeric mono">{document.chunks}</td>
                <td>{document.updated}</td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      </Panel>
      <Panel eyebrow="Retrieval invariants" title="Auditable by construction">
        <div className="principle-grid">
          <div>
            <ShieldCheck size={18} aria-hidden="true" />
            <span>
              <strong>Point-in-time filtering</strong>
              <small>
                No decision sees a document version that was unavailable at
                decision time.
              </small>
            </span>
          </div>
          <div>
            <Fingerprint size={18} aria-hidden="true" />
            <span>
              <strong>Deterministic chunking</strong>
              <small>
                Content hashes make duplicate import and version lineage
                explicit.
              </small>
            </span>
          </div>
          <div>
            <FileText size={18} aria-hidden="true" />
            <span>
              <strong>Evidence, not instruction</strong>
              <small>
                Imported text is sanitized and delimited before any model can
                inspect it.
              </small>
            </span>
          </div>
        </div>
      </Panel>
    </div>
  )
}
