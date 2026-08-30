import { describe, expect, it } from 'vitest'

import {
  expectedChecksumEntries,
  parseGitNameStatus,
  serializeChecksumEntries,
  verifyChecksumManifest,
} from './handoff-checksums.mjs'

const changed = ['a.txt', 'folder/b.sql']
const bytes = new Map([
  ['a.txt', Buffer.from('alpha\r\n', 'utf8')],
  ['folder/b.sql', Buffer.from('select 1;\n', 'utf8')],
])
const entries = expectedChecksumEntries(changed, (filePath: string) =>
  bytes.get(filePath)!,
)
const valid = serializeChecksumEntries(entries)

describe('handoff checksum completeness', () => {
  it('verifies the exact merge-base path set and raw checkout bytes', () => {
    expect(verifyChecksumManifest(valid, entries).entryCount).toBe(2)
    const lfEntries = expectedChecksumEntries(changed, (filePath: string) =>
      filePath === 'a.txt'
        ? Buffer.from('alpha\n', 'utf8')
        : bytes.get(filePath)!,
    )
    expect(() => verifyChecksumManifest(valid, lfEntries)).toThrow('stale')
  })

  it.each([
    ['stale hash', valid.replace(entries[0].sha256, 'f'.repeat(64))],
    [
      'omitted file',
      `${entries[0].sha256}  ${entries[0].status}  ${entries[0].path}\n`,
    ],
    ['extra file', `${valid}${'f'.repeat(64)}  A  extra.txt\n`],
    [
      'duplicate path',
      `${valid}${entries[0].sha256}  ${entries[0].status}  ${entries[0].path}\n`,
    ],
  ])('rejects %s', (_label, manifest) => {
    expect(() => verifyChecksumManifest(manifest, entries)).toThrow()
  })

  it('rejects differently cased duplicates', () => {
    expect(() =>
      expectedChecksumEntries(['A.txt', 'a.txt'], () => Buffer.from('x')),
    ).toThrow('case-drifted')
  })

  it('includes exact base bytes for deletions and both sides of a rename', () => {
    const records = parseGitNameStatus([
      'D',
      'deleted.sql',
      'R100',
      'old.sql',
      'new.sql',
    ])
    expect(records).toEqual([
      { path: 'deleted.sql', source: 'base', status: 'D' },
      { path: 'old.sql', source: 'base', status: 'D' },
      { path: 'new.sql', source: 'head', status: 'A' },
    ])
    const deletionEntries = expectedChecksumEntries(
      records,
      (filePath: string, source: string) =>
        Buffer.from(`${source}:${filePath}\r\n`),
    )
    expect(
      deletionEntries.map(
        ({ path, status }: { path: string; status: string }) => ({
          path,
          status,
        }),
      ),
    ).toEqual([
      { path: 'deleted.sql', status: 'D' },
      { path: 'new.sql', status: 'A' },
      { path: 'old.sql', status: 'D' },
    ])
  })
})
