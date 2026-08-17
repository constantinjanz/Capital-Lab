import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  canonicalJson,
  loadCriticalRelationContract,
  sha256,
} from './critical-backup-contract.mjs'
import { canonicalRepositoryTextBytes } from './lib/canonical-repository-bytes.mjs'
import {
  inspectOwnedDatabaseContainer,
  ownedDatabaseContainer,
  runOwnedPostgresTool,
} from './lib/local-container-postgres.mjs'
import { localCiImageIdentityEvidence } from './lib/owned-local-ci-stack.mjs'

export function parseLocalMigrationReplayOptions(argv) {
  const entries = argv.map((argument) => {
    const match =
      /^--(contract|seed|target)=(pre|post|include|omit|ci|reference)$/u.exec(
        argument,
      )
    if (!match) throw new Error('Local migration replay arguments are invalid')
    return [match[1], match[2]]
  })
  const parsed = Object.fromEntries(entries)
  if (
    entries.length !== 3 ||
    new Set(entries.map(([key]) => key)).size !== 3 ||
    !['pre', 'post'].includes(parsed.contract) ||
    !['include', 'omit'].includes(parsed.seed) ||
    !['ci', 'reference'].includes(parsed.target) ||
    (parsed.seed === 'include' &&
      (parsed.contract !== 'post' || parsed.target !== 'ci'))
  ) {
    throw new Error('Exact contract, target, and seed policy are required')
  }
  return parsed
}

export function migrationContainerName(target, runId) {
  const role = target === 'ci' ? 'source' : 'reference'
  const env =
    target === 'ci'
      ? { CAPITAL_LAB_CI_RUN_ID: runId }
      : {
          CAPITAL_LAB_REFERENCE_DATABASE_PORT: '56001',
          CAPITAL_LAB_REFERENCE_RUN_ID: runId,
        }
  return ownedDatabaseContainer(role, env).container
}

export function migrationIdentity(filename) {
  const match = /^(\d{14})_([a-z0-9_]+)\.sql$/u.exec(filename)
  if (!match) throw new Error('Migration filename is not canonical')
  return { version: match[1], name: match[2] }
}

async function runPsql(role, input, capture = false) {
  return runOwnedPostgresTool(
    role,
    'psql',
    [
      '--no-psqlrc',
      '--quiet',
      '--set=ON_ERROR_STOP=1',
      ...(capture ? ['--tuples-only', '--no-align'] : []),
    ],
    input,
  )
}

async function queryJson(role, sql) {
  const outcome = await runPsql(role, sql, true)
  return JSON.parse(outcome.stdout.trim())
}

const HISTORY_CONTRACT_SQL = `select jsonb_build_object(
  'columns', (
    select jsonb_agg(jsonb_build_object(
      'name', column_name, 'nullable', is_nullable, 'type', udt_name
    ) order by ordinal_position)
    from information_schema.columns
    where table_schema = 'supabase_migrations'
      and table_name = 'schema_migrations'
  ),
  'primaryKey', (
    select jsonb_agg(attribute.attname order by key.ordinality)
    from pg_catalog.pg_constraint as constraint_row
    cross join lateral unnest(constraint_row.conkey) with ordinality as key(attnum, ordinality)
    join pg_catalog.pg_class as relation on relation.oid = constraint_row.conrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    join pg_catalog.pg_attribute as attribute
      on attribute.attrelid = relation.oid and attribute.attnum = key.attnum
    where constraint_row.contype = 'p'
      and namespace.nspname = 'supabase_migrations'
      and relation.relname = 'schema_migrations'
  ),
  'rows', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', name, 'version', version
    ) order by version), '[]'::jsonb)
    from supabase_migrations.schema_migrations
  )
);`

const EXPECTED_HISTORY_CONTRACT = {
  columns: [
    { name: 'version', nullable: 'NO', type: 'text' },
    { name: 'statements', nullable: 'YES', type: '_text' },
    { name: 'name', nullable: 'YES', type: 'text' },
  ],
  primaryKey: ['version'],
  rows: [],
}

export function historyInsertSql(filename, bytes) {
  const identity = migrationIdentity(filename)
  const body = Buffer.from(bytes).toString('utf8')
  const tag = `$capital_lab_${identity.version}$`
  if (body.includes(tag)) {
    throw new Error('Migration body conflicts with history delimiter')
  }
  return `begin;
insert into supabase_migrations.schema_migrations(version, name, statements)
values ('${identity.version}', '${identity.name}', array[${tag}${body}${tag}]::text[]);
commit;
`
}

async function main() {
  const requested = parseLocalMigrationReplayOptions(process.argv.slice(2))
  const workspace = await realpath(process.cwd())
  const role = requested.target === 'ci' ? 'source' : 'reference'
  const target = inspectOwnedDatabaseContainer(role)
  process.stdout.write(
    `${JSON.stringify({ status: 'local_container_image_identity_verified', role, ...localCiImageIdentityEvidence(target.identity) })}\n`,
  )
  const kind =
    requested.contract === 'pre' ? 'pre_activation' : 'post_activation'
  const contractPath = path.join(
    workspace,
    'supabase',
    'backup',
    `${requested.contract}-activation.v1.json`,
  )
  const { contract } = await loadCriticalRelationContract(contractPath, kind)
  const before = await queryJson(role, HISTORY_CONTRACT_SQL)
  if (canonicalJson(before) !== canonicalJson(EXPECTED_HISTORY_CONTRACT)) {
    throw new Error(
      'Local Supabase migration history boundary is not empty and exact',
    )
  }
  const expectedHistory = []
  for (const migration of contract.migrations) {
    const filename = path.join(
      workspace,
      'supabase',
      'migrations',
      migration.name,
    )
    const bytes = await readFile(filename)
    const canonical = canonicalRepositoryTextBytes(bytes)
    const identity = migrationIdentity(migration.name)
    if (
      migration.version !== identity.version ||
      sha256(canonical) !== migration.sha256
    ) {
      throw new Error('Local migration bytes differ from the reviewed contract')
    }
    await runPsql(
      role,
      Buffer.concat([
        Buffer.from(
          "\\set ON_ERROR_STOP on\nset statement_timeout = '300s';\nset lock_timeout = '10s';\n",
          'utf8',
        ),
        bytes,
        Buffer.from('\n', 'utf8'),
      ]),
    )
    await runPsql(role, historyInsertSql(migration.name, bytes))
    expectedHistory.push({ name: identity.name, version: identity.version })
  }
  const after = await queryJson(role, HISTORY_CONTRACT_SQL)
  if (
    canonicalJson(after) !==
    canonicalJson({ ...EXPECTED_HISTORY_CONTRACT, rows: expectedHistory })
  ) {
    throw new Error('Local migration history differs after psql replay')
  }
  if (requested.seed === 'include') {
    const seed = await readFile(path.join(workspace, 'supabase', 'seed.sql'))
    await runPsql(role, seed)
  }
  process.stdout.write(
    `${JSON.stringify({ status: 'local_migrations_replayed', contract: requested.contract, migrationCount: expectedHistory.length, seed: requested.seed })}\n`,
  )
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main().catch(() => {
    process.stderr.write('Local migration replay failed closed.\n')
    process.exit(1)
  })
}
