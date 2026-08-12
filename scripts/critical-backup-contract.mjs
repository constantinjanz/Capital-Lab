import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { canonicalRepositoryTextBytes } from './lib/canonical-repository-bytes.mjs'

const RELATION = /^(?:public|private)\.[a-z][a-z0-9_]{0,62}$/
const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/
const SHA256 = /^[0-9a-f]{64}$/

export const BACKUP_ARTIFACT_KEYS = Object.freeze([
  'roles',
  'authSchema',
  'authData',
  'schema',
  'data',
  'historySchema',
  'historyData',
])

export function buildAuthEvidenceSql() {
  return `select jsonb_build_object(
    'schemaVersion', 1,
    'userCount', (select count(*)::text from auth.users),
    'mappedApplicationOwnerCount', (
      select count(*)::text from public.app_users as app_user
      join auth.users as auth_user on auth_user.id = app_user.user_id
    ),
    'relationCounts', (
      select coalesce(jsonb_object_agg(relation_name, row_count order by relation_name), '{}'::jsonb)
      from (
        select table_name as relation_name,
          (xpath('/row/count/text()', query_to_xml(
            format('select count(*) as count from auth.%I', table_name),
            false, true, ''
          )))[1]::text as row_count
        from information_schema.tables
        where table_schema = 'auth' and table_type = 'BASE TABLE'
      ) as counts
    )
  );\n`
}

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
    'databaseRole', current_user,
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

const APPLICATION_DEFAULT_ACL_OWNER = 'postgres'
const PLATFORM_DEFAULT_ACL_OWNER = 'supabase_admin'

export function filterApplicationSchemaArchiveToc(toc) {
  if (typeof toc !== 'string' || !toc.endsWith('\n')) {
    throw new Error('PostgreSQL schema archive TOC is invalid')
  }
  let applicationCount = 0
  let platformCount = 0
  const filtered = toc.split('\n').filter((line) => {
    if (!line.includes(' DEFAULT ACL ')) return true
    if (!/^\d+;\s+\d+\s+\d+\s+DEFAULT ACL\s/u.test(line)) {
      throw new Error('PostgreSQL DEFAULT ACL archive entry is malformed')
    }
    const owner = line.trim().split(/\s+/u).at(-1)
    if (owner === APPLICATION_DEFAULT_ACL_OWNER) {
      applicationCount += 1
      return true
    }
    if (owner === PLATFORM_DEFAULT_ACL_OWNER) {
      platformCount += 1
      return false
    }
    throw new Error('PostgreSQL DEFAULT ACL owner is not classified')
  })
  return {
    applicationCount,
    platformCount,
    toc: filtered.join('\n'),
  }
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

export async function loadCriticalRelationContract(filename, expectedKind) {
  const bytes = canonicalRepositoryTextBytes(await readFile(filename))
  const contract = JSON.parse(bytes.toString('utf8'))
  if (bytes.toString('utf8') !== `${canonicalJson(contract)}\n`) {
    throw new Error('Critical-relation contract must be canonical JSON')
  }
  if (
    contract.schemaVersion !== 4 ||
    contract.contractKind !== expectedKind ||
    contract.schemaFingerprintVersion !== 'capital-lab-schema-fingerprint-v2' ||
    !Array.isArray(contract.relations) ||
    !Array.isArray(contract.migrations) ||
    !Array.isArray(contract.nonCriticalAllowlist) ||
    contract.nonCriticalAllowlist.length !== 0
  ) {
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
  if (
    contract.migrations.some(
      (migration) =>
        !/^\d{14}_[a-z0-9_]+\.sql$/u.test(migration.name) ||
        migration.version !== migration.name.slice(0, 14) ||
        !SHA256.test(migration.sha256),
    ) ||
    JSON.stringify(contract.migrations.map((migration) => migration.name)) !==
      JSON.stringify(
        contract.migrations.map((migration) => migration.name).sort(),
      )
  ) {
    throw new Error('Critical-relation migration mapping is invalid')
  }
  return { contract, sha256: sha256(bytes) }
}

export async function loadSchemaGolden(
  filename,
  expectedKind,
  expectedRelationContractSha256,
) {
  const bytes = canonicalRepositoryTextBytes(await readFile(filename))
  const golden = JSON.parse(bytes.toString('utf8'))
  if (
    bytes.toString('utf8') !== `${canonicalJson(golden)}\n` ||
    golden.schemaVersion !== 1 ||
    golden.contractKind !== expectedKind ||
    golden.schemaFingerprintVersion !== 'capital-lab-schema-fingerprint-v2' ||
    golden.relationContractSha256 !== expectedRelationContractSha256 ||
    !SHA256.test(golden.schemaFingerprintSha256 ?? '') ||
    !SHA256.test(golden.relationSetSha256 ?? '') ||
    !SHA256.test(golden.migrationHistorySha256 ?? '')
  ) {
    throw new Error('Committed schema golden is invalid or stale')
  }
  return { golden, sha256: sha256(bytes) }
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
      'primaryKey', (
        select coalesce(jsonb_agg(attribute.attname order by key_column.ordinality), '[]'::jsonb)
        from pg_catalog.pg_constraint as primary_constraint
        cross join lateral unnest(primary_constraint.conkey)
          with ordinality as key_column(attnum, ordinality)
        join pg_catalog.pg_attribute as attribute
          on attribute.attrelid = primary_constraint.conrelid
          and attribute.attnum = key_column.attnum
        where primary_constraint.conrelid = '${spec.relation}'::regclass
          and primary_constraint.contype = 'p'
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

export function buildSchemaFingerprintExpression() {
  return `select encode(extensions.digest(convert_to(jsonb_build_object(
    'schemas', (select coalesce(jsonb_agg(jsonb_build_object(
      'schema', namespace.nspname, 'owner', owner.rolname,
      'acl', namespace.nspacl
    ) order by namespace.nspname), '[]'::jsonb)
    from pg_catalog.pg_namespace as namespace
    join pg_catalog.pg_roles as owner on owner.oid = namespace.nspowner
    where namespace.nspname in ('public','private')),
    'relations', (select coalesce(jsonb_agg(jsonb_build_object(
      'schema', namespace.nspname, 'name', relation.relname,
      'kind', relation.relkind, 'persistence', relation.relpersistence,
      'owner', owner.rolname, 'accessMethod', access_method.amname,
      'acl', relation.relacl
    ) order by namespace.nspname, relation.relname), '[]'::jsonb)
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    join pg_catalog.pg_roles as owner on owner.oid = relation.relowner
    left join pg_catalog.pg_am as access_method on access_method.oid = relation.relam
    where namespace.nspname in ('public','private')
      and relation.relkind in ('r','p','v','m','S')),
    'columns', (select coalesce(jsonb_agg(jsonb_build_object(
      'schema', namespace.nspname, 'relation', relation.relname,
      'position', attribute.attnum, 'name', attribute.attname,
      'type', pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
      'notNull', attribute.attnotnull, 'identity', attribute.attidentity,
      'generated', attribute.attgenerated,
      'default', pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid)
    ) order by namespace.nspname, relation.relname, attribute.attnum), '[]'::jsonb)
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    join pg_catalog.pg_attribute as attribute on attribute.attrelid = relation.oid
    left join pg_catalog.pg_attrdef as default_value
      on default_value.adrelid = relation.oid and default_value.adnum = attribute.attnum
    where namespace.nspname in ('public','private') and relation.relkind in ('r','p','v','m')
      and attribute.attnum > 0 and not attribute.attisdropped),
    'constraints', (select coalesce(jsonb_agg(jsonb_build_object(
      'schema', namespace.nspname, 'relation', relation.relname,
      'name', constraint_record.conname, 'type', constraint_record.contype,
      'definition', pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
    ) order by namespace.nspname, relation.relname, constraint_record.conname), '[]'::jsonb)
    from pg_catalog.pg_constraint as constraint_record
    join pg_catalog.pg_class as relation on relation.oid = constraint_record.conrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname in ('public','private')),
    'indexes', (select coalesce(jsonb_agg(jsonb_build_object(
      'schema', schemaname, 'relation', tablename, 'name', indexname,
      'definition', indexdef
    ) order by schemaname, tablename, indexname), '[]'::jsonb)
    from pg_catalog.pg_indexes where schemaname in ('public','private')),
    'rowSecurity', (select coalesce(jsonb_agg(jsonb_build_object(
      'schema', namespace.nspname, 'relation', relation.relname,
      'enabled', relation.relrowsecurity, 'forced', relation.relforcerowsecurity
    ) order by namespace.nspname, relation.relname), '[]'::jsonb)
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname in ('public','private') and relation.relkind in ('r','p')),
    'policies', (select coalesce(jsonb_agg(jsonb_build_object(
      'schema', schemaname, 'relation', tablename, 'name', policyname,
      'permissive', permissive, 'roles', roles, 'command', cmd,
      'using', qual, 'check', with_check
    ) order by schemaname, tablename, policyname), '[]'::jsonb)
    from pg_catalog.pg_policies where schemaname in ('public','private')),
    'tableGrants', (select coalesce(jsonb_agg(jsonb_build_object(
      'schema', table_schema, 'relation', table_name, 'grantee', grantee,
      'privilege', privilege_type, 'grantable', is_grantable
    ) order by table_schema, table_name, grantee, privilege_type), '[]'::jsonb)
    from information_schema.table_privileges where table_schema in ('public','private')),
    'triggers', (select coalesce(jsonb_agg(jsonb_build_object(
      'schema', namespace.nspname, 'relation', relation.relname,
      'name', trigger_record.tgname,
      'definition', pg_catalog.pg_get_triggerdef(trigger_record.oid, true)
    ) order by namespace.nspname, relation.relname, trigger_record.tgname), '[]'::jsonb)
    from pg_catalog.pg_trigger as trigger_record
    join pg_catalog.pg_class as relation on relation.oid = trigger_record.tgrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname in ('public','private') and not trigger_record.tgisinternal),
    'functions', (select coalesce(jsonb_agg(jsonb_build_object(
      'schema', namespace.nspname, 'identity', procedure.oid::regprocedure::text,
      'securityDefiner', procedure.prosecdef, 'volatility', procedure.provolatile,
      'parallel', procedure.proparallel, 'definition', pg_catalog.pg_get_functiondef(procedure.oid)
    ) order by namespace.nspname, procedure.oid::regprocedure::text), '[]'::jsonb)
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname in ('public','private')),
    'functionGrants', (select coalesce(jsonb_agg(jsonb_build_object(
      'schema', namespace.nspname, 'identity', procedure.oid::regprocedure::text,
      'grantee', coalesce(grantee.rolname, 'PUBLIC'), 'privilege', privilege.privilege_type,
      'grantable', privilege.is_grantable
    ) order by namespace.nspname, procedure.oid::regprocedure::text,
      coalesce(grantee.rolname, 'PUBLIC'), privilege.privilege_type), '[]'::jsonb)
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    cross join lateral pg_catalog.aclexplode(coalesce(procedure.proacl,
      pg_catalog.acldefault('f', procedure.proowner))) as privilege
    left join pg_catalog.pg_roles as grantee on grantee.oid = privilege.grantee
    where namespace.nspname in ('public','private')),
    'views', (select coalesce(jsonb_agg(jsonb_build_object(
      'schema', namespace.nspname, 'name', relation.relname,
      'kind', relation.relkind, 'definition', pg_catalog.pg_get_viewdef(relation.oid, true)
    ) order by namespace.nspname, relation.relname), '[]'::jsonb)
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname in ('public','private') and relation.relkind in ('v','m')),
    'types', (select coalesce(jsonb_agg(jsonb_build_object(
      'schema', namespace.nspname, 'name', type_record.typname,
      'kind', type_record.typtype, 'category', type_record.typcategory,
      'notNull', type_record.typnotnull,
      'baseType', case when type_record.typbasetype = 0 then null
        else type_record.typbasetype::regtype::text end,
      'constraint', pg_catalog.pg_get_constraintdef(constraint_record.oid, true),
      'enumValues', (select jsonb_agg(enum_record.enumlabel order by enum_record.enumsortorder)
        from pg_catalog.pg_enum as enum_record where enum_record.enumtypid = type_record.oid)
    ) order by namespace.nspname, type_record.typname), '[]'::jsonb)
    from pg_catalog.pg_type as type_record
    join pg_catalog.pg_namespace as namespace on namespace.oid = type_record.typnamespace
    left join pg_catalog.pg_constraint as constraint_record
      on constraint_record.contypid = type_record.oid
    where namespace.nspname in ('public','private')
      and type_record.typtype in ('d','e')),
    'sequences', (select coalesce(jsonb_agg(jsonb_build_object(
      'schema', schemaname, 'name', sequencename, 'owner', sequenceowner,
      'type', data_type, 'start', start_value::text, 'minimum', min_value::text,
      'maximum', max_value::text, 'increment', increment_by::text,
      'cycle', cycle, 'cache', cache_size::text
    ) order by schemaname, sequencename), '[]'::jsonb)
    from pg_catalog.pg_sequences where schemaname in ('public','private')),
    'defaultPrivileges', (select coalesce(jsonb_agg(jsonb_build_object(
      'owner', owner.rolname, 'schema', namespace.nspname,
      'objectType', default_acl.defaclobjtype, 'acl', default_acl.defaclacl
    ) order by owner.rolname, namespace.nspname, default_acl.defaclobjtype), '[]'::jsonb)
    from pg_catalog.pg_default_acl as default_acl
    join pg_catalog.pg_roles as owner on owner.oid = default_acl.defaclrole
    left join pg_catalog.pg_namespace as namespace on namespace.oid = default_acl.defaclnamespace
    where namespace.nspname in ('public','private') or namespace.nspname is null),
    'extensions', (select coalesce(jsonb_agg(jsonb_build_object(
      'name', extension.extname, 'schema', namespace.nspname,
      'version', extension.extversion, 'relocatable', extension.extrelocatable
    ) order by extension.extname), '[]'::jsonb)
    from pg_catalog.pg_extension as extension
    join pg_catalog.pg_namespace as namespace on namespace.oid = extension.extnamespace),
    'authDependencies', jsonb_build_object(
      'relations', (select coalesce(jsonb_agg(jsonb_build_object(
        'name', relation.relname, 'owner', owner.rolname, 'acl', relation.relacl,
        'rlsEnabled', relation.relrowsecurity, 'rlsForced', relation.relforcerowsecurity
      ) order by relation.relname), '[]'::jsonb)
      from pg_catalog.pg_class as relation
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      join pg_catalog.pg_roles as owner on owner.oid = relation.relowner
      where namespace.nspname = 'auth' and relation.relname in ('users','identities')
        and relation.relkind in ('r','p')),
      'columns', (select coalesce(jsonb_agg(jsonb_build_object(
        'relation', relation.relname, 'position', attribute.attnum,
        'name', attribute.attname,
        'type', pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
        'notNull', attribute.attnotnull, 'identity', attribute.attidentity,
        'generated', attribute.attgenerated,
        'default', pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid)
      ) order by relation.relname, attribute.attnum), '[]'::jsonb)
      from pg_catalog.pg_class as relation
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      join pg_catalog.pg_attribute as attribute on attribute.attrelid = relation.oid
      left join pg_catalog.pg_attrdef as default_value
        on default_value.adrelid = relation.oid and default_value.adnum = attribute.attnum
      where namespace.nspname = 'auth' and relation.relname in ('users','identities')
        and attribute.attnum > 0 and not attribute.attisdropped),
      'constraints', (select coalesce(jsonb_agg(jsonb_build_object(
        'relation', relation.relname, 'name', constraint_record.conname,
        'type', constraint_record.contype,
        'definition', pg_catalog.pg_get_constraintdef(constraint_record.oid, true)
      ) order by relation.relname, constraint_record.conname), '[]'::jsonb)
      from pg_catalog.pg_constraint as constraint_record
      join pg_catalog.pg_class as relation on relation.oid = constraint_record.conrelid
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'auth' and relation.relname in ('users','identities')),
      'indexes', (select coalesce(jsonb_agg(jsonb_build_object(
        'relation', tablename, 'name', indexname, 'definition', indexdef
      ) order by tablename, indexname), '[]'::jsonb)
      from pg_catalog.pg_indexes
      where schemaname = 'auth' and tablename in ('users','identities')),
      'policies', (select coalesce(jsonb_agg(jsonb_build_object(
        'relation', tablename, 'name', policyname, 'permissive', permissive,
        'roles', roles, 'command', cmd, 'using', qual, 'check', with_check
      ) order by tablename, policyname), '[]'::jsonb)
      from pg_catalog.pg_policies
      where schemaname = 'auth' and tablename in ('users','identities'))
    )
  )::text, 'UTF8'), 'sha256'), 'hex')`
}

export function buildCriticalEvidenceSql(contract) {
  const union = contract.relations.map(relationSql).join('\nunion all\n')
  const relationSet = contract.relations.map((spec) => spec.relation).join('\n')
  return `\\set ON_ERROR_STOP on
select jsonb_build_object(
  'schemaVersion', 4,
  'contractKind', '${contract.contractKind}',
  'databaseFingerprint', (
    select encode(extensions.digest(convert_to(
      database.oid::text || ':' || database.datname || ':'
        || current_setting('server_version_num') || ':' || control.system_identifier::text,
      'UTF8'), 'sha256'), 'hex')
    from pg_catalog.pg_control_system() as control
    cross join pg_catalog.pg_database as database
    where database.datname = current_database()
  ),
  'serverVersion', current_setting('server_version_num'),
  'appliedMigrations', coalesce((
    select jsonb_agg(jsonb_build_object('version', version, 'name', name) order by version)
    from supabase_migrations.schema_migrations
  ), '[]'::jsonb),
  'migrationHistorySha256', (
    select encode(extensions.digest(convert_to(coalesce(string_agg(
      jsonb_build_object('version', version, 'name', name)::text,
      E'\\n' order by version
    ), ''), 'UTF8'), 'sha256'), 'hex')
    from supabase_migrations.schema_migrations
  ),
  'relationSetSha256', encode(extensions.digest(convert_to(
    '${relationSet}', 'UTF8'), 'sha256'), 'hex'),
  'schemaFingerprintSha256', (${buildSchemaFingerprintExpression()}),
  'catalogRelations', (
    select coalesce(jsonb_agg(
      namespace.nspname || '.' || relation.relname
      order by namespace.nspname, relation.relname
    ), '[]'::jsonb)
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname in ('public','private')
      and relation.relkind in ('r','p')
  ),
  'relations', (select jsonb_object_agg(relation_name, evidence order by relation_name)
    from (${union}) as relation_evidence)
) as evidence;
`
}

export function buildSchemaGoldenEvidenceSql(contract) {
  const relationSet = contract.relations.map((spec) => spec.relation).join('\n')
  return `\\set ON_ERROR_STOP on
select jsonb_build_object(
  'appliedMigrations', coalesce((
    select jsonb_agg(jsonb_build_object('version', version, 'name', name) order by version)
    from supabase_migrations.schema_migrations
  ), '[]'::jsonb),
  'catalogRelations', (
    select coalesce(jsonb_agg(namespace.nspname || '.' || relation.relname
      order by namespace.nspname, relation.relname), '[]'::jsonb)
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname in ('public','private') and relation.relkind in ('r','p')
  ),
  'migrationHistorySha256', (
    select encode(extensions.digest(convert_to(coalesce(string_agg(
      jsonb_build_object('version', version, 'name', name)::text,
      E'\\n' order by version
    ), ''), 'UTF8'), 'sha256'), 'hex')
    from supabase_migrations.schema_migrations
  ),
  'relationSetSha256', encode(extensions.digest(convert_to(
    '${relationSet}', 'UTF8'), 'sha256'), 'hex'),
  'schemaFingerprintSha256', (${buildSchemaFingerprintExpression()})
) as evidence;\n`
}

export function assertContractKeys(contract, evidence) {
  const expectedRelations = contract.relations.map((spec) => spec.relation)
  if (
    canonicalJson(evidence?.catalogRelations) !==
    canonicalJson(expectedRelations)
  ) {
    throw new Error('Database base-relation set differs from backup contract')
  }
  for (const spec of contract.relations) {
    if (
      canonicalJson(evidence?.relations?.[spec.relation]?.primaryKey) !==
      canonicalJson(spec.primaryKey)
    ) {
      throw new Error('Database primary key differs from backup contract')
    }
  }
}

export function assertBackupManifest(manifest, expected) {
  const relationNames = Object.keys(manifest.relations ?? {}).sort()
  const evidenceValid = relationNames.every((name) => {
    const evidence = manifest.relations[name]
    return (
      /^\d+$/.test(evidence?.rowCount) &&
      /^\d+$/.test(evidence?.columnCount) &&
      Array.isArray(evidence?.primaryKey) &&
      evidence.primaryKey.length > 0 &&
      evidence.primaryKey.every((key) => IDENTIFIER.test(key)) &&
      SHA256.test(evidence?.contentSha256) &&
      SHA256.test(evidence?.columnSignatureSha256)
    )
  })
  const artifactsValid =
    BACKUP_ARTIFACT_KEYS.every(
      (key) =>
        /^[a-zA-Z0-9._-]+\.sql$/.test(manifest.artifacts?.[key]?.file ?? '') &&
        SHA256.test(manifest.artifacts?.[key]?.sha256 ?? ''),
    ) &&
    new Set(BACKUP_ARTIFACT_KEYS.map((key) => manifest.artifacts?.[key]?.file))
      .size === BACKUP_ARTIFACT_KEYS.length
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
    auth_evidence:
      manifest.authEvidence?.schemaVersion === 1 &&
      /^\d+$/.test(manifest.authEvidence?.userCount ?? '') &&
      /^\d+$/.test(manifest.authEvidence?.mappedApplicationOwnerCount ?? '') &&
      manifest.authEvidence?.relationCounts &&
      Object.values(manifest.authEvidence.relationCounts).every((value) =>
        /^\d+$/.test(value),
      ),
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
    relation_set_hash:
      SHA256.test(manifest.relationSetSha256 ?? '') &&
      manifest.relationSetSha256 === expected.relationSetSha256,
    relation_set:
      canonicalJson(relationNames) === canonicalJson(expected.relationNames),
    restore_prelude:
      SHA256.test(manifest.restorePreludeSha256 ?? '') &&
      manifest.restorePreludeSha256 === expected.restorePreludeSha256,
    schema_contract:
      manifest.schemaVersion === 6 &&
      manifest.contractKind === expected.contractKind &&
      manifest.schemaContractVersion ===
        `capital-lab-${expected.contractKind}-backup-v6`,
    schema_golden:
      SHA256.test(manifest.schemaGoldenSha256 ?? '') &&
      manifest.schemaGoldenSha256 === expected.schemaGoldenSha256 &&
      manifest.schemaFingerprintSha256 === expected.schemaFingerprintSha256,
    schema_fingerprint:
      SHA256.test(manifest.schemaFingerprintSha256 ?? '') &&
      manifest.schemaFingerprintSha256 ===
        manifest.source?.schemaFingerprintSha256,
    source_fingerprint: SHA256.test(manifest.source?.databaseFingerprint ?? ''),
    source_role_policy: SHA256.test(
      manifest.source?.rolePolicyFingerprint ?? '',
    ),
    source_server_fingerprint: SHA256.test(
      manifest.source?.serverFingerprint ?? '',
    ),
    source_server_version: /^\d+$/.test(manifest.source?.serverVersion ?? ''),
    source_schema_fingerprint: SHA256.test(
      manifest.source?.schemaFingerprintSha256 ?? '',
    ),
    source_migration_history: SHA256.test(
      manifest.source?.migrationHistorySha256 ?? '',
    ),
    snapshot_policy:
      manifest.snapshotPolicy
        ?.applicationAuthAndHistoryShareExportedSnapshot === true &&
      manifest.snapshotPolicy?.isolation === 'repeatable read read only' &&
      manifest.snapshotPolicy?.rolePolicyComparedOutsideSnapshot === true &&
      manifest.snapshotPolicy?.sourceStateReverifiedAfterExport === true &&
      [null, 'application-setting-v1'].includes(
        manifest.snapshotPolicy?.localRaceFixture,
      ),
    default_acl_policy:
      manifest.defaultAclPolicy?.applicationOwner === 'postgres' &&
      Number.isSafeInteger(manifest.defaultAclPolicy?.applicationEntryCount) &&
      manifest.defaultAclPolicy.applicationEntryCount >= 0 &&
      manifest.defaultAclPolicy?.platformExcludedOwner === 'supabase_admin' &&
      Number.isSafeInteger(
        manifest.defaultAclPolicy?.platformExcludedEntryCount,
      ) &&
      manifest.defaultAclPolicy.platformExcludedEntryCount >= 0,
    supabase_cli: manifest.toolVersions?.supabase === '2.113.0',
    pg_dump_version:
      /^pg_dump \(PostgreSQL\) \d+(?:\.\d+)*(?: [ -~]{1,120})?$/.test(
        manifest.toolVersions?.pgDump ?? '',
      ),
    pg_dumpall_version:
      /^pg_dumpall \(PostgreSQL\) \d+(?:\.\d+)*(?: [ -~]{1,120})?$/.test(
        manifest.toolVersions?.pgDumpall ?? '',
      ),
    pg_restore_version:
      /^pg_restore \(PostgreSQL\) \d+(?:\.\d+)*(?: [ -~]{1,120})?$/.test(
        manifest.toolVersions?.pgRestore ?? '',
      ),
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
    canonicalJson(actualEvidence.catalogRelations) !==
      canonicalJson(Object.keys(manifest.relations).sort()) ||
    canonicalJson(actualEvidence.relations) !==
      canonicalJson(manifest.relations) ||
    canonicalJson(actualEvidence.appliedMigrations) !==
      canonicalJson(manifest.source.appliedMigrations) ||
    actualEvidence.migrationHistorySha256 !==
      manifest.source.migrationHistorySha256 ||
    actualEvidence.schemaFingerprintSha256 !==
      manifest.schemaFingerprintSha256 ||
    actualEvidence.relationSetSha256 !== manifest.relationSetSha256 ||
    actualEvidence.contractKind !== manifest.contractKind
  ) {
    throw new Error(
      'Restored full-row, column, migration, or relation evidence differs',
    )
  }
}

export function assertRestoredAuthEvidence(manifest, actualAuthEvidence) {
  if (
    canonicalJson(actualAuthEvidence) !== canonicalJson(manifest.authEvidence)
  ) {
    throw new Error(
      'Restored Auth relation-count or owner-mapping evidence differs',
    )
  }
}
