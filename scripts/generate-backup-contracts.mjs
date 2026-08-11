import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { canonicalRepositoryTextBytes } from './lib/canonical-repository-bytes.mjs'

const PENDING = new Set([
  '20260809150000_post_build_hosting_safety.sql',
  '20260809150417_activation_readiness_follow_up.sql',
])

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function matchingParen(sql, opening) {
  let depth = 0
  let quote = null
  for (let index = opening; index < sql.length; index += 1) {
    const character = sql[index]
    if (quote) {
      if (character === quote && sql[index - 1] !== '\\') quote = null
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      continue
    }
    if (character === '(') depth += 1
    if (character === ')' && --depth === 0) return index
  }
  throw new Error('Migration table definition has unbalanced parentheses')
}

function splitTopLevel(value) {
  const parts = []
  let start = 0
  let depth = 0
  let quote = null
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (quote) {
      if (character === quote && value[index - 1] !== '\\') quote = null
      continue
    }
    if (character === "'" || character === '"') quote = character
    else if (character === '(') depth += 1
    else if (character === ')') depth -= 1
    else if (character === ',' && depth === 0) {
      parts.push(value.slice(start, index).trim())
      start = index + 1
    }
  }
  parts.push(value.slice(start).trim())
  return parts.filter(Boolean)
}

function identifiers(value) {
  return value
    .split(',')
    .map((column) => column.trim().replaceAll('"', ''))
    .filter((column) => /^[a-z][a-z0-9_]{0,62}$/u.test(column))
}

export function relationsFromMigrations(migrations) {
  const relations = new Map()
  for (const migration of migrations) {
    const create =
      /create\s+table\s+(public|private)\.([a-z][a-z0-9_]*)\s*\(/giu
    let match
    while ((match = create.exec(migration.sql))) {
      const opening = create.lastIndex - 1
      const closing = matchingParen(migration.sql, opening)
      const clauses = splitTopLevel(migration.sql.slice(opening + 1, closing))
      const columns = clauses
        .map((clause) => /^"?([a-z][a-z0-9_]*)"?\s+/iu.exec(clause)?.[1])
        .filter(Boolean)
      let primaryKey = []
      for (const clause of clauses) {
        const tablePrimary =
          /(?:constraint\s+[a-z][a-z0-9_]*\s+)?primary\s+key\s*\(([^)]+)\)/iu.exec(
            clause,
          )
        if (tablePrimary) primaryKey = identifiers(tablePrimary[1])
        const inline = /^"?([a-z][a-z0-9_]*)"?\s+.*\bprimary\s+key\b/iu.exec(
          clause,
        )
        if (inline) primaryKey = [inline[1]]
      }
      if (columns.length === 0)
        throw new Error(`No columns parsed for ${match[1]}.${match[2]}`)
      relations.set(`${match[1]}.${match[2]}`, {
        columns,
        primaryKey: primaryKey.length > 0 ? primaryKey : [columns[0]],
      })
      create.lastIndex = closing + 1
    }
    const alter =
      /alter\s+table\s+(public|private)\.([a-z][a-z0-9_]*)[\s\S]*?;/giu
    while ((match = alter.exec(migration.sql))) {
      const relation = relations.get(`${match[1]}.${match[2]}`)
      const primary =
        /add(?:\s+constraint\s+[a-z][a-z0-9_]*)?\s+primary\s+key\s*\(([^)]+)\)/iu.exec(
          match[0],
        )
      if (relation && primary) relation.primaryKey = identifiers(primary[1])
    }
  }
  return [...relations.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([relation, spec]) => ({
      evidenceRule: 'full-row-sha256',
      primaryKey: spec.primaryKey,
      relation,
      sortKey: spec.primaryKey,
    }))
}

async function buildContract(migrationDirectory, kind, files) {
  const selected =
    kind === 'pre_activation'
      ? files.filter((file) => !PENDING.has(file))
      : files
  const migrations = await Promise.all(
    selected.map(async (name) => {
      const bytes = canonicalRepositoryTextBytes(
        await readFile(path.join(migrationDirectory, name)),
      )
      return {
        name,
        sha256: sha256(bytes),
        sql: bytes.toString('utf8'),
        version: name.slice(0, 14),
      }
    }),
  )
  return {
    contractKind: kind,
    migrations: migrations.map(({ name, sha256: checksum, version }) => ({
      name,
      sha256: checksum,
      version,
    })),
    nonCriticalAllowlist: [],
    relations: relationsFromMigrations(migrations),
    schemaFingerprintVersion: 'capital-lab-schema-fingerprint-v1',
    schemaVersion: 3,
  }
}

async function main() {
  if (
    process.argv.length !== 3 ||
    !['--write', '--verify'].includes(process.argv[2])
  ) {
    throw new Error('Required: exactly one of --write or --verify')
  }
  const repository = process.cwd()
  const migrationDirectory = path.join(repository, 'supabase', 'migrations')
  const files = (await readdir(migrationDirectory))
    .filter((name) => /^\d{14}_[a-z0-9_]+\.sql$/u.test(name))
    .sort()
  const outputs = new Map([
    [
      'pre-activation.v1.json',
      await buildContract(migrationDirectory, 'pre_activation', files),
    ],
    [
      'post-activation.v1.json',
      await buildContract(migrationDirectory, 'post_activation', files),
    ],
  ])
  for (const [filename, contract] of outputs) {
    const target = path.join(repository, 'supabase', 'backup', filename)
    const expected = `${canonicalJson(contract)}\n`
    if (process.argv[2] === '--write') await writeFile(target, expected)
    else if ((await readFile(target, 'utf8')) !== expected) {
      throw new Error(`${filename} is incomplete or stale`)
    }
  }
  process.stdout.write(
    `${JSON.stringify({ status: process.argv[2] === '--write' ? 'generated' : 'verified', preRelationCount: outputs.get('pre-activation.v1.json').relations.length, postRelationCount: outputs.get('post-activation.v1.json').relations.length })}\n`,
  )
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main().catch((error) => {
    console.error(
      error instanceof Error
        ? error.message
        : 'Backup contract generation failed',
    )
    process.exit(1)
  })
}
