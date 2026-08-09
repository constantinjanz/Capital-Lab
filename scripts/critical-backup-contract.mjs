import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const RELATION = /^(?:public|private)\.[a-z][a-z0-9_]{0,62}$/
const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/
const SHA256 = /^[0-9a-f]{64}$/

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

export function postgresUrlToLibpqEnv(value, { localOnly = false } = {}) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('PostgreSQL connection URL is invalid')
  }
  const hostname = parsed.hostname.replace(/^\[(.*)\]$/u, '$1')
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(hostname)
  const database = decodeURIComponent(parsed.pathname.slice(1))
  const username = decodeURIComponent(parsed.username)
  const password = decodeURIComponent(parsed.password)
  const port = parsed.port || '5432'
  const searchKeys = [...parsed.searchParams.keys()]
  const sslmode = parsed.searchParams.get('sslmode')
  if (
    parsed.protocol !== 'postgresql:' ||
    parsed.hash ||
    !hostname ||
    !username ||
    !password ||
    !database ||
    database.includes('/') ||
    !/^\d{1,5}$/u.test(port) ||
    Number(port) < 1 ||
    Number(port) > 65535 ||
    searchKeys.some((key) => key !== 'sslmode') ||
    searchKeys.filter((key) => key === 'sslmode').length > 1 ||
    (loopback && sslmode !== null && sslmode !== 'disable') ||
    (!loopback && sslmode !== 'verify-full') ||
    (localOnly && !loopback)
  ) {
    throw new Error('PostgreSQL connection target or TLS policy is invalid')
  }
  return {
    database,
    hostname,
    port,
    libpqEnv: {
      PGDATABASE: database,
      PGHOST: hostname,
      PGPASSWORD: password,
      PGPORT: port,
      PGSSLMODE: loopback ? 'disable' : 'verify-full',
      PGUSER: username,
    },
  }
}

export async function loadCriticalRelationContract(filename) {
  const bytes = await readFile(filename)
  const contract = JSON.parse(bytes.toString('utf8'))
  if (bytes.toString('utf8') !== `${canonicalJson(contract)}\n`) {
    throw new Error('Critical-relation contract must be canonical JSON')
  }
  if (contract.schemaVersion !== 2 || !Array.isArray(contract.relations)) {
    throw new Error('Critical-relation contract version is invalid')
  }
  const seen = new Set()
  for (const spec of contract.relations) {
    if (
      !RELATION.test(spec.relation) ||
      spec.evidenceRule !== 'full-row-sha256' ||
      !Array.isArray(spec.primaryKey) ||
      spec.primaryKey.length === 0 ||
      !Array.isArray(spec.sortKey) ||
      spec.sortKey.length === 0 ||
      !spec.primaryKey.every((key) => IDENTIFIER.test(key)) ||
      !spec.sortKey.every((key) => IDENTIFIER.test(key)) ||
      seen.has(spec.relation)
    ) {
      throw new Error('Critical-relation contract entry is invalid')
    }
    seen.add(spec.relation)
  }
  const names = contract.relations.map((spec) => spec.relation)
  if (JSON.stringify(names) !== JSON.stringify([...names].sort())) {
    throw new Error('Critical-relation contract must be relation-sorted')
  }
  return { contract, sha256: sha256(bytes) }
}

function quoteIdentifier(identifier) {
  if (!IDENTIFIER.test(identifier)) throw new Error('Unsafe SQL identifier')
  return `"${identifier}"`
}

function relationSql(spec) {
  const [schema, table] = spec.relation.split('.')
  const qualified = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`
  const sort = spec.sortKey
    .map((key) => `source_row.${quoteIdentifier(key)}::text`)
    .join(', ')
  return `select '${spec.relation}'::text as relation_name,
    jsonb_build_object(
      'rowCount', count(*)::text,
      'contentSha256', encode(extensions.digest(convert_to(
        coalesce(string_agg(to_jsonb(source_row)::text, E'\\n' order by ${sort}), ''),
        'UTF8'), 'sha256'), 'hex'),
      'columnCount', (
        select count(*)::text from pg_catalog.pg_attribute as attribute
        where attribute.attrelid = '${spec.relation}'::regclass
          and attribute.attnum > 0 and not attribute.attisdropped
      ),
      'columnSignatureSha256', (
        select encode(extensions.digest(convert_to(coalesce(string_agg(
          jsonb_build_object(
            'name', attribute.attname,
            'type', pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
            'notNull', attribute.attnotnull,
            'identity', attribute.attidentity,
            'generated', attribute.attgenerated,
            'default', pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid)
          )::text, E'\\n' order by attribute.attnum
        ), ''), 'UTF8'), 'sha256'), 'hex')
        from pg_catalog.pg_attribute as attribute
        left join pg_catalog.pg_attrdef as default_value
          on default_value.adrelid = attribute.attrelid
          and default_value.adnum = attribute.attnum
        where attribute.attrelid = '${spec.relation}'::regclass
          and attribute.attnum > 0 and not attribute.attisdropped
      )
    ) as evidence
  from ${qualified} as source_row`
}

export function buildCriticalEvidenceSql(contract) {
  const union = contract.relations.map(relationSql).join('\nunion all\n')
  return `\\set ON_ERROR_STOP on
select jsonb_build_object(
  'schemaVersion', 2,
  'databaseFingerprint', private.activation_database_fingerprint(),
  'serverVersion', current_setting('server_version_num'),
  'appliedMigrations', coalesce((
    select jsonb_agg(jsonb_build_object('version', version, 'name', name) order by version)
    from supabase_migrations.schema_migrations
  ), '[]'::jsonb),
  'relations', (select jsonb_object_agg(relation_name, evidence order by relation_name)
    from (${union}) as relation_evidence)
) as evidence;
`
}

export function assertBackupManifest(manifest, expected) {
  const relationNames = Object.keys(manifest.relations ?? {}).sort()
  const evidenceValid = relationNames.every((name) => {
    const evidence = manifest.relations[name]
    return (
      /^\d+$/.test(evidence?.rowCount) &&
      /^\d+$/.test(evidence?.columnCount) &&
      SHA256.test(evidence?.contentSha256) &&
      SHA256.test(evidence?.columnSignatureSha256)
    )
  })
  const artifactsValid = ['roles', 'schema', 'data'].every(
    (key) =>
      /^[a-zA-Z0-9._-]+\.sql$/.test(manifest.artifacts?.[key]?.file ?? '') &&
      SHA256.test(manifest.artifacts?.[key]?.sha256 ?? ''),
  )
  const appliedMigrationsValid =
    Array.isArray(manifest.source?.appliedMigrations) &&
    manifest.source.appliedMigrations.every((applied) =>
      expected.migrations.some(
        (migration) =>
          migration.version === applied.version &&
          migration.name.slice(15, -4) === applied.name,
      ),
    )
  if (
    manifest.schemaVersion !== 2 ||
    manifest.schemaContractVersion !== 'capital-lab-activation-backup-v2' ||
    Number.isNaN(Date.parse(manifest.createdAt)) ||
    !/^[0-9a-f]{40}$/.test(manifest.gitCommitSha) ||
    !SHA256.test(manifest.relationContractSha256) ||
    manifest.relationContractSha256 !== expected.relationContractSha256 ||
    manifest.gitCommitSha !== expected.gitCommitSha ||
    canonicalJson(relationNames) !== canonicalJson(expected.relationNames) ||
    !evidenceValid ||
    !artifactsValid ||
    !appliedMigrationsValid ||
    !SHA256.test(manifest.source?.databaseFingerprint ?? '') ||
    !/^\d+$/.test(manifest.source?.serverVersion ?? '') ||
    manifest.toolVersions?.supabase !== '2.113.0' ||
    !/^psql \(PostgreSQL\) \d+(?:\.\d+)*$/.test(
      manifest.toolVersions?.psql ?? '',
    ) ||
    canonicalJson(manifest.migrations) !== canonicalJson(expected.migrations)
  ) {
    throw new Error(
      'Backup manifest HEAD, migration, relation, or schema contract mismatch',
    )
  }
}

export function assertRestoredEvidence(manifest, actualEvidence) {
  if (
    canonicalJson(actualEvidence.relations) !==
      canonicalJson(manifest.relations) ||
    canonicalJson(actualEvidence.appliedMigrations) !==
      canonicalJson(manifest.source.appliedMigrations)
  ) {
    throw new Error(
      'Restored full-row, column, migration, or relation evidence differs',
    )
  }
}
