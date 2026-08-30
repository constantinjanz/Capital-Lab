import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  resolveNativeExecutable,
  resolvedArguments,
} from './lib/safe-process.mjs'

const EXCLUDED = new Set([
  'docs/post-build/activation-readiness-checksums.sha256',
  'docs/post-build/activation-readiness-follow-up.md',
])
const HASH_LINE = /^([0-9a-f]{64})  ([ADM])  ([^\0\r\n]+)$/u

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function normalizedPath(value) {
  const result = value.replaceAll('\\', '/')
  if (
    !result ||
    result.startsWith('/') ||
    result.includes('/../') ||
    result.startsWith('../') ||
    result.includes('\0')
  ) {
    throw new Error('Checksum path is not canonical')
  }
  return result
}

export function expectedChecksumEntries(changedPaths, bytesByPath) {
  const records = changedPaths
    .map((entry) =>
      typeof entry === 'string'
        ? { path: normalizedPath(entry), source: 'head', status: 'M' }
        : {
            path: normalizedPath(entry.path),
            source: entry.source,
            status: entry.status,
          },
    )
    .filter((entry) => !EXCLUDED.has(entry.path))
  if (
    records.some(
      (entry) =>
        !['base', 'head'].includes(entry.source) ||
        !['A', 'D', 'M'].includes(entry.status) ||
        (entry.status === 'D') !== (entry.source === 'base'),
    )
  ) {
    throw new Error('Changed-file record is invalid')
  }
  const exact = new Set(records.map((entry) => entry.path))
  const folded = new Set(records.map((entry) => entry.path.toLowerCase()))
  if (exact.size !== records.length || folded.size !== records.length) {
    throw new Error('Changed-file set contains duplicate or case-drifted paths')
  }
  records.sort((left, right) => left.path.localeCompare(right.path, 'en'))
  return records.map((entry) => {
    const bytes = bytesByPath(entry.path, entry.source)
    if (!Buffer.isBuffer(bytes))
      throw new Error('Canonical Git bytes are unavailable')
    return { path: entry.path, sha256: sha256(bytes), status: entry.status }
  })
}

export function serializeChecksumEntries(entries) {
  return `${entries.map((entry) => `${entry.sha256}  ${entry.status}  ${entry.path}`).join('\n')}\n`
}

export function parseChecksumManifest(text) {
  if (typeof text !== 'string' || !text.endsWith('\n')) {
    throw new Error('Checksum manifest must end with one canonical newline')
  }
  const lines = text.slice(0, -1).split('\n')
  const entries = lines.map((line) => {
    const match = HASH_LINE.exec(line)
    if (!match) throw new Error('Checksum manifest line is invalid')
    return {
      sha256: match[1],
      status: match[2],
      path: normalizedPath(match[3]),
    }
  })
  const exact = new Set(entries.map((entry) => entry.path))
  const folded = new Set(entries.map((entry) => entry.path.toLowerCase()))
  if (exact.size !== entries.length || folded.size !== entries.length) {
    throw new Error(
      'Checksum manifest contains duplicate or case-drifted paths',
    )
  }
  return entries
}

export function parseGitNameStatus(tokens) {
  const records = []
  for (let index = 0; index < tokens.length;) {
    const statusToken = tokens[index++]
    if (!/^(?:[AMDTUXB]|R\d{1,3}|C\d{1,3})$/u.test(statusToken ?? '')) {
      throw new Error('Git changed-file status is invalid')
    }
    const status = statusToken[0]
    if (status === 'R' || status === 'C') {
      const oldPath = tokens[index++]
      const newPath = tokens[index++]
      if (!oldPath || !newPath)
        throw new Error('Git rename/copy record is incomplete')
      if (status === 'R') {
        records.push({ path: oldPath, source: 'base', status: 'D' })
      }
      records.push({ path: newPath, source: 'head', status: 'A' })
    } else {
      const filePath = tokens[index++]
      if (!filePath) throw new Error('Git changed-file record is incomplete')
      records.push({
        path: filePath,
        source: status === 'D' ? 'base' : 'head',
        status: status === 'A' ? 'A' : status === 'D' ? 'D' : 'M',
      })
    }
  }
  return records
}

export function verifyChecksumManifest(text, expectedEntries) {
  const actual = parseChecksumManifest(text)
  const expectedText = serializeChecksumEntries(expectedEntries)
  if (serializeChecksumEntries(actual) !== expectedText) {
    throw new Error(
      'Checksum manifest has a missing, extra, stale, or reordered entry',
    )
  }
  return {
    entryCount: actual.length,
    sha256: sha256(Buffer.from(text, 'utf8')),
  }
}

function git(args, cwd, encoding = 'utf8') {
  const executable = resolveNativeExecutable('git')
  const result = spawnSync(
    executable.command,
    resolvedArguments(executable, args),
    {
      cwd,
      encoding,
      shell: false,
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    },
  )
  if (result.status !== 0 || result.signal) {
    throw new Error('Canonical Git checksum evidence could not be derived')
  }
  return result.stdout
}

async function main() {
  if (
    process.argv.length !== 3 ||
    !['--write', '--verify'].includes(process.argv[2])
  ) {
    throw new Error('Usage: handoff-checksums.mjs --write|--verify')
  }
  const repository = await realpath(process.cwd())
  const head = git(['rev-parse', 'HEAD'], repository).trim()
  if (!/^[0-9a-f]{40}$/u.test(head)) throw new Error('Git HEAD is invalid')
  const base = git(['merge-base', 'HEAD', 'origin/main'], repository).trim()
  if (!/^[0-9a-f]{40}$/u.test(base)) {
    throw new Error('Real merge base is unavailable; fetch origin/main history')
  }
  const changedOutput = git(
    ['diff', '--name-status', '--find-renames', '-z', base, 'HEAD', '--'],
    repository,
    'buffer',
  )
  const changedTokens = changedOutput
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
  const entries = expectedChecksumEntries(
    parseGitNameStatus(changedTokens),
    (filePath, source) =>
      git(
        ['show', `${source === 'base' ? base : head}:${filePath}`],
        repository,
        'buffer',
      ),
  )
  const manifestPath = path.join(
    repository,
    'docs',
    'post-build',
    'activation-readiness-checksums.sha256',
  )
  if (process.argv[2] === '--write') {
    await writeFile(manifestPath, serializeChecksumEntries(entries), 'utf8')
  }
  const manifestText = await readFile(manifestPath, 'utf8')
  const evidence = verifyChecksumManifest(manifestText, entries)
  process.stdout.write(
    `${JSON.stringify({ status: 'handoff_checksums_verified', head, mergeBase: base, ...evidence })}\n`,
  )
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : 'Checksum verification failed',
    )
    process.exit(1)
  })
}
