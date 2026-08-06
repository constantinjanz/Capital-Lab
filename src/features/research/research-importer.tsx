'use client'

import { CheckCircle2, FileSearch, UploadCloud } from 'lucide-react'
import { useState } from 'react'

export function ResearchImporter() {
  const [file, setFile] = useState<{ name: string; size: string } | null>(null)
  const [committed, setCommitted] = useState(false)

  return (
    <div className="importer">
      <label className="import-dropzone" htmlFor="research-file">
        <UploadCloud size={24} aria-hidden="true" />
        <strong>Choose a research file</strong>
        <span>
          Markdown, JSON strategy card, or CSV source registry · local preview
          only
        </span>
        <input
          id="research-file"
          type="file"
          accept=".md,.json,.csv,text/markdown,application/json,text/csv"
          onChange={(event) => {
            const selected = event.target.files?.[0]
            if (!selected) return
            setCommitted(false)
            setFile({
              name: selected.name,
              size: `${Math.max(1, Math.round(selected.size / 1024))} KB`,
            })
          }}
        />
      </label>
      {file ? (
        <div className="import-preview">
          <div className="import-preview__heading">
            <FileSearch size={18} aria-hidden="true" />
            <span>
              <strong>{file.name}</strong>
              <small>{file.size} · content not uploaded</small>
            </span>
            <span className="text-positive">Preview valid</span>
          </div>
          <dl>
            <div>
              <dt>Sanitization</dt>
              <dd>Passed</dd>
            </div>
            <div>
              <dt>Metadata</dt>
              <dd>4 fields recognized</dd>
            </div>
            <div>
              <dt>Duplicate check</dt>
              <dd>No matching mock hash</dd>
            </div>
            <div>
              <dt>Estimated chunks</dt>
              <dd>12</dd>
            </div>
          </dl>
          <p>
            This preview demonstrates validation without persisting the file.
            Commit creates only an in-memory confirmation in mock mode.
          </p>
          <button
            type="button"
            className="button button--primary"
            onClick={() => setCommitted(true)}
            disabled={committed}
          >
            <CheckCircle2 size={15} aria-hidden="true" />
            {committed ? 'Committed locally' : 'Commit mock import'}
          </button>
        </div>
      ) : null}
      <p className="action-message" aria-live="polite">
        {committed
          ? 'Synthetic document committed to the local preview session. No remote storage was changed.'
          : ''}
      </p>
    </div>
  )
}
