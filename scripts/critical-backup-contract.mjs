import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const RELATION = /^(?:public|private)\.[a-z][a-z0-9_]{0,62}$/
const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/
const SHA256 = /^[0-9a-f]{64}$/

export const BACKUP_ARTIFACT_KEYS = Object.freeze([
  'roles',
  'schema',
  'data',
  'historySchema',
  'historyData',
])

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

export function buildServerIdentitySql() {
  return `select jsonb_build_object(
    'databaseIdentity', database.oid::text || ':' || database.datname || ':'
      || current_setting('server_version_num') || ':' || control.system_identifier::text,
    'serverIdentity', current_setting('server_version_num') || ':'
      || control.system_identifier::text
  )
  from pg_catalog.pg_control_system() as control
  cross join pg_catalog.pg_database as database
  where database.datname = current_database();\n`
}

export function buildRolePolicySql() {
  return `select jsonb_build_object(
    'roles', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', role.rolname,
        'superuser', role.rolsuper,
        'inherit', role.rolinherit,
        'createRole', role.rolcreaterole,
        'createDatabase', role.rolcreatedb,
        'canLogin', role.rolcanlogin,
        'replication', role.rolreplication,
        'connectionLimit', role.rolconnlimit,
        'bypassRls', role.rolbypassrls,
        'validUntil', role.rolvaliduntil,
        'configuration', role.rolconfig
      ) order by role.rolname), '[]'::jsonb)
      from pg_catalog.pg_roles as role
    ),
    'memberships', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'role', granted_role.rolname,
        'member', member_role.rolname,
        'adminOption', membership.admin_option
      ) order by granted_role.rolname, member_role.rolname), '[]'::jsonb)
      from pg_catalog.pg_auth_members as membership
      join pg_catalog.pg_roles as granted_role on granted_role.oid = membership.roleid
      join pg_catalog.pg_roles as member_role on member_role.oid = membership.member
    )
  );\n`
}

export function fingerprintRolePolicy(rolePolicy) {
  if (
    !rolePolicy ||
    typeof rolePolicy !== 'object' ||
    Array.isArray(rolePolicy) ||
    !Array.isArray(rolePolicy.roles) ||
    !Array.isArray(rolePolicy.memberships) ||
    Object.keys(rolePolicy).sort().join(',') !== 'memberships,roles'
  ) {
    throw new Error('Database role policy evidence is invalid')
  }
  return sha256(canonicalJson(rolePolicy))
}

export function roleRestoreRequired(
  sourceRolePolicyFingerprint,
  targetRolePolicyFingerprint,
  sameServer,
) {
  if (
    !SHA256.test(sourceRolePolicyFingerprint) ||
    !SHA256.test(targetRolePolicyFingerprint) ||
    typeof sameServer !== 'boolean'
  ) {
    throw new Error('Role-policy restore evidence is invalid')
  }
  if (sourceRolePolicyFingerprint === targetRolePolicyFingerprint) return false
  if (sameServer) {
    throw new Error('Same-server disposable target role policy differs')
  }
  return true
}

export function redactedPostgresError(stderr) {
  const errorLine = stderr
    .split(/\r?\n/u)
    .find((line) => /(?:^|:\s)error:/iu.test(line))
  if (!errorLine) return 'postgres-error-unclassified'
  return errorLine
    .replace(/'[^']*'/gu, "'[redacted-literal]'")
    .replace(/(?:postgres(?:ql)?|https?):\/\/\S+/giu, '[redacted-url]')
    .replace(/\s+/gu, ' ')
    .slice(0, 400)
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

export function criticalRelationSchemas(contract) {
  if (!contract || !Array.isArray(contract.relations)) {
    throw new Error('Critical-relation schema scope is invalid')
  }
  const schemas = [
    ...new Set(
      contract.relations.map((spec) => {
        if (!spec || !RELATION.test(spec.relation)) {
          throw new Error('Critical-relation schema scope is invalid')
        }
        return spec.relation.split('.')[0]
      }),
    ),
  ].sort()
  if (schemas.length === 0) {
    throw new Error('Critical-relation schema scope is invalid')
  }
  return schemas
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
  const artifactsValid = BACKUP_ARTIFACT_KEYS.every(
    (key) =>
      /^[a-zA-Z0-9._-]+\.sql$/.test(manifest.artifacts?.[key]?.file ?? '') &&
      SHA256.test(manifest.artifacts?.[key]?.sha256 ?? ''),
  )
  const appliedMigrationsValid =
    Array.isArray(manifest.source?.appliedMigrations) &&
    manifest.source.appliedMigrations.length === expected.migrations.length &&
    manifest.source.appliedMigrations.every((applied) =>
      expected.migrations.some(
        (migration) =>
          migration.version === applied.version &&
          migration.name.slice(15, -4) === applied.name,
      ),
    )
  const checks = {
    applied_migrations: appliedMigrationsValid,
    artifact_metadata: artifactsValid,
    created_at: !Number.isNaN(Date.parse(manifest.createdAt)),
    data_schemas:
      canonicalJson(manifest.dataSchemas) ===
      canonicalJson(expected.dataSchemas),
    evidence_shape: evidenceValid,
    git_commit:
      /^[0-9a-f]{40}$/.test(manifest.gitCommitSha) &&
      manifest.gitCommitSha === expected.gitCommitSha,
    migration_checksums:
      canonicalJson(manifest.migrations) === canonicalJson(expected.migrations),
    relation_contract:
      SHA256.test(manifest.relationContractSha256 ?? '') &&
      manifest.relationContractSha256 === expected.relationContractSha256,
    relation_set:
      canonicalJson(relationNames) === canonicalJson(expected.relationNames),
    restore_prelude:
      SHA256.test(manifest.restorePreludeSha256 ?? '') &&
      manifest.restorePreludeSha256 === expected.restorePreludeSha256,
    schema_contract:
      manifest.schemaVersion === 3 &&
      manifest.schemaContractVersion === 'capital-lab-activation-backup-v3',
    source_fingerprint: SHA256.test(manifest.source?.databaseFingerprint ?? ''),
    source_role_policy: SHA256.test(
      manifest.source?.rolePolicyFingerprint ?? '',
    ),
    source_server_fingerprint: SHA256.test(
      manifest.source?.serverFingerprint ?? '',
    ),
    source_server_version: /^\d+$/.test(manifest.source?.serverVersion ?? ''),
    supabase_cli: manifest.toolVersions?.supabase === '2.113.0',
    psql_version: /^psql \(PostgreSQL\) \d+(?:\.\d+)*(?: [ -~]{1,120})?$/.test(
      manifest.toolVersions?.psql ?? '',
    ),
  }
  const failedChecks = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name)
  if (failedChecks.length > 0) {
    throw new Error(`Backup manifest mismatch: ${failedChecks.join(',')}`)
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
