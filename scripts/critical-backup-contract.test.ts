import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

import {
  AUTH_DATA_RELATIONS,
  assertBackupManifest,
  assertContractKeys,
  assertEmptyRestoreTargetPreflight,
  assertRestoredAuthEvidence,
  assertRestoredEvidence,
  assertForeignKeyCatalog,
  buildForeignKeyCatalogSql,
  buildForeignKeyViolationSql,
  buildRolePolicySql,
  buildSchemaFingerprintPayloadExpression,
  buildServerIdentitySql,
  buildSensitiveAuthStateSql,
  canonicalJson,
  criticalRelationSchemas,
  filterApplicationSchemaArchiveToc,
  fingerprintRolePolicy,
  postgresUrlToLibpqEnv,
  redactedPostgresError,
  roleRestoreRequired,
  sha256,
} from './critical-backup-contract.mjs'

const hashA = 'a'.repeat(64)
const hashB = 'b'.repeat(64)
const schemaEvidence = {
  schemas: [{ schema: 'private', owner: 'postgres', acl: null }],
  relations: [{ schema: 'private', name: 'example', owner: 'postgres' }],
  columns: [
    {
      schema: 'private',
      relation: 'example',
      name: 'id',
      type: 'uuid',
      default: 'gen_random_uuid()',
    },
  ],
  constraints: [
    {
      schema: 'private',
      relation: 'example',
      name: 'example_owner_fkey',
      type: 'f',
      definition: 'FOREIGN KEY (owner_id) REFERENCES public.app_users(user_id)',
    },
  ],
  indexes: [{ schema: 'private', relation: 'example', name: 'example_pkey' }],
  rowSecurity: [
    { schema: 'private', relation: 'example', enabled: true, forced: true },
  ],
  policies: [
    {
      schema: 'private',
      relation: 'example',
      name: 'owner_select',
      using: '(owner_id = auth.uid())',
    },
  ],
  tableGrants: [
    {
      schema: 'private',
      relation: 'example',
      grantee: 'service_role',
      privilege: 'SELECT',
    },
  ],
  triggers: [
    {
      schema: 'private',
      relation: 'example',
      name: 'protect_example',
      definition: 'CREATE TRIGGER protect_example BEFORE DELETE',
    },
  ],
  functions: [
    {
      schema: 'private',
      identity: 'private.example_guard()',
      definition:
        "CREATE FUNCTION private.example_guard() RETURNS trigger SET search_path TO ''",
    },
  ],
  functionGrants: [],
  views: [],
  types: [],
  sequences: [],
  defaultPrivileges: [],
  extensions: [],
  authDependencies: {},
}
const schemaEvidenceSha256 = sha256(canonicalJson(schemaEvidence))
const relations = {
  'private.no_ai_shadow_dry_runs': {
    rowCount: '1',
    contentSha256: hashA,
    columnCount: '10',
    columnSignatureSha256: hashB,
    primaryKey: ['id'],
  },
  'private.paid_canary_runs': {
    rowCount: '3',
    contentSha256: hashB,
    columnCount: '9',
    columnSignatureSha256: hashA,
    primaryKey: ['id'],
  },
}
const migrations = [
  {
    name: '20260809150417_activation.sql',
    sha256: hashA,
    version: '20260809150417',
  },
]
const manifest = {
  artifacts: {
    roles: { file: 'roles.sql', sha256: hashA },
    authSchema: { file: 'auth-schema.sql', sha256: hashA },
    authData: { file: 'auth-data.sql', sha256: hashB },
    schema: { file: 'schema.sql', sha256: hashA },
    data: { file: 'data.sql', sha256: hashA },
    historySchema: { file: 'history-schema.sql', sha256: hashB },
    historyData: { file: 'history-data.sql', sha256: hashB },
  },
  authEvidence: {
    schemaVersion: 2,
    contractVersion: 'capital-lab-auth-user-identity-closure-v1',
    dataRelations: [...AUTH_DATA_RELATIONS],
    excludedDataRelations: ['auth.sessions'],
    userCount: '2',
    identityCount: '2',
    mappedApplicationOwnerCount: '1',
    orphanApplicationOwnerCount: '0',
    orphanIdentityCount: '0',
    usersWithoutIdentityCount: '0',
  },
  createdAt: '2026-08-10T00:00:00.000Z',
  contractKind: 'post_activation',
  dataSchemas: ['private'],
  defaultAclPolicy: {
    applicationEntryCount: 6,
    applicationOwner: 'postgres',
    platformExcludedEntryCount: 3,
    platformExcludedOwner: 'supabase_admin',
  },
  schemaVersion: 7,
  schemaContractVersion: 'capital-lab-post_activation-backup-v7',
  schemaEvidenceSha256,
  schemaFingerprintSha256: hashA,
  schemaGoldenSha256: hashB,
  gitCommitSha: 'c'.repeat(40),
  relationContractSha256: hashA,
  relationSetSha256: hashB,
  restorePreludeSha256: hashB,
  relations,
  migrations,
  snapshotPolicy: {
    applicationAuthAndHistoryShareExportedSnapshot: true,
    isolation: 'repeatable read read only',
    localRaceFixture: null,
    rolePolicyComparedOutsideSnapshot: true,
    sourceStateReverifiedAfterExport: true,
  },
  source: {
    appliedMigrations: [{ version: '20260809150417', name: 'activation' }],
    databaseFingerprint: hashB,
    rolePolicyFingerprint: hashA,
    schemaEvidenceSha256,
    schemaFingerprintSha256: hashA,
    migrationHistorySha256: hashB,
    serverFingerprint: hashB,
    serverVersion: '170006',
  },
  toolVersions: {
    pgDump: 'pg_dump (PostgreSQL) 17.6',
    pgDumpall: 'pg_dumpall (PostgreSQL) 17.6',
    pgRestore: 'pg_restore (PostgreSQL) 17.6',
    psql: 'psql (PostgreSQL) 17.6',
    supabase: '2.113.0',
  },
}
const expected = {
  contractKind: 'post_activation',
  dataSchemas: ['private'],
  gitCommitSha: 'c'.repeat(40),
  relationContractSha256: hashA,
  relationNames: Object.keys(relations).sort(),
  relationSetSha256: hashB,
  restorePreludeSha256: hashB,
  schemaEvidenceSha256,
  schemaFingerprintSha256: hashA,
  schemaGoldenSha256: hashB,
  migrations,
}

describe('critical backup contract', () => {
  it('keeps the exporter read-only and limits Auth data to the reviewed closure', () => {
    const exporter = readFileSync(
      new URL('./export-critical-tables.mjs', import.meta.url),
      'utf8',
    )
    const writer = readFileSync(
      new URL('./run-local-mvcc-race-writer.mjs', import.meta.url),
      'utf8',
    )
    expect(exporter).not.toMatch(
      /(?:insert into|delete from) private\.application_settings/iu,
    )
    expect(exporter).toContain('AUTH_DATA_RELATIONS.flatMap')
    expect(AUTH_DATA_RELATIONS).toEqual(['auth.identities', 'auth.users'])
    expect(exporter).toMatch(
      /snapshotArgument,\s*'--schema-only',\s*'--schema',\s*'auth'/u,
    )
    expect(exporter).not.toMatch(
      /snapshotArgument,\s*'--schema-only',\s*'--no-owner',\s*'--schema',\s*'auth'/u,
    )
    expect(writer).toMatch(/insert into private\.application_settings/iu)
    expect(writer).toMatch(/delete from private\.application_settings/iu)
  })

  it('fingerprints the complete supported Auth schema dependency closure', () => {
    const sql = buildSchemaFingerprintPayloadExpression()
    for (const key of [
      "'schema'",
      "'columns'",
      "'constraints'",
      "'indexes'",
      "'policies'",
      "'tableGrants'",
      "'triggers'",
      "'functions'",
      "'functionGrants'",
      "'views'",
    ]) {
      expect(sql.slice(sql.indexOf("'authDependencies'"))).toContain(key)
    }
    expect(sql).toContain("namespace.nspname = 'auth'")
    expect(sql).not.toContain("relation.relname in ('users','identities')")
    expect(sql).toContain("relation.relkind in ('r','p')")
    expect(buildSensitiveAuthStateSql()).toContain('auth.users')
    expect(buildSensitiveAuthStateSql()).toContain('auth.identities')
    expect(buildSensitiveAuthStateSql()).not.toMatch(/email|password/iu)
  })

  it('builds a schema-driven, row-redacted foreign-key orphan check', () => {
    const catalog = {
      constraints: [
        {
          name: 'example_owner_fkey',
          childSchema: 'private',
          childTable: 'example',
          childColumns: ['owner_id'],
          parentSchema: 'public',
          parentTable: 'app_users',
          parentColumns: ['user_id'],
          matchType: 's',
        },
      ],
    }
    expect(() => assertForeignKeyCatalog(catalog)).not.toThrow()
    const sql = buildForeignKeyViolationSql(catalog.constraints[0])
    expect(sql).toContain('violationCount')
    expect(sql).toContain('not exists')
    expect(sql).not.toContain('select child.*')
    expect(buildForeignKeyCatalogSql()).toContain(
      "constraint_record.contype = 'f'",
    )
    expect(() =>
      buildForeignKeyViolationSql({
        ...catalog.constraints[0],
        childTable: 'example; drop schema public',
      }),
    ).toThrow(/unsafe identifier/)
  })
  it('keeps application DEFAULT ACL entries and excludes only platform-owned entries', () => {
    const toc = [
      '; PostgreSQL database dump',
      '101; 0 0 TABLE public app_users postgres',
      '201; 826 9001 DEFAULT ACL public DEFAULT PRIVILEGES FOR TABLES postgres',
      '202; 826 9002 DEFAULT ACL public DEFAULT PRIVILEGES FOR FUNCTIONS supabase_admin',
      '',
    ].join('\n')
    expect(filterApplicationSchemaArchiveToc(toc)).toEqual({
      applicationCount: 1,
      platformCount: 1,
      toc: [
        '; PostgreSQL database dump',
        '101; 0 0 TABLE public app_users postgres',
        '201; 826 9001 DEFAULT ACL public DEFAULT PRIVILEGES FOR TABLES postgres',
        '',
      ].join('\n'),
    })
    expect(() =>
      filterApplicationSchemaArchiveToc(
        '203; 826 9003 DEFAULT ACL public DEFAULT PRIVILEGES FOR TABLES unexpected_owner\n',
      ),
    ).toThrow('DEFAULT ACL owner is not classified')
  })

  it('prepares only the exact separately identified disposable stack B', () => {
    const source = readFileSync(
      new URL('./prepare-seed-free-local-restore-target.mjs', import.meta.url),
      'utf8',
    )
    expect(source).toContain('restoreProjectId(runId)')
    expect(source).toContain("target.port !== '55322'")
    expect(source).toContain(
      'sourceIdentity.serverIdentity === targetIdentity.serverIdentity',
    )
    expect(source).toContain('buildRestoreTargetProof')
    expect(source).toContain('capital_lab_restore.run_identity')
    expect(
      source.indexOf(
        'const containerIdentity = validateRestoreContainerInspection',
      ),
    ).toBeLessThan(source.indexOf('create schema capital_lab_restore'))
    expect(
      source.indexOf('const proof = buildRestoreTargetProof'),
    ).toBeLessThan(source.indexOf('drop schema if exists private cascade'))
    expect(source).not.toMatch(/drop database/iu)
  })

  it('accepts only a relation-empty target with non-null distinct identities', () => {
    const sourceServerIdentity = '170000:source-system-identifier'
    const sourceDatabaseFingerprint = sha256(
      '42:postgres:170000:source-system-identifier',
    )
    const valid = {
      userRelations: 0,
      authPresent: false,
      serverIdentity: '170000:target-system-identifier',
      databaseIdentity: '84:postgres:170000:target-system-identifier',
    }
    expect(() =>
      assertEmptyRestoreTargetPreflight(
        valid,
        sourceServerIdentity,
        sourceDatabaseFingerprint,
      ),
    ).not.toThrow()
    for (const invalid of [
      { ...valid, userRelations: 1 },
      { ...valid, authPresent: true },
      { ...valid, serverIdentity: null },
      { ...valid, databaseIdentity: null },
      { ...valid, serverIdentity: sourceServerIdentity },
      {
        ...valid,
        databaseIdentity: '42:postgres:170000:source-system-identifier',
      },
    ]) {
      expect(() =>
        assertEmptyRestoreTargetPreflight(
          invalid,
          sourceServerIdentity,
          sourceDatabaseFingerprint,
        ),
      ).toThrow(/empty disposable database/)
    }
  })

  it('hashes a secret-free deterministic role policy and server boundary', () => {
    const rolePolicy = {
      roles: [
        {
          name: 'authenticator',
          canLogin: true,
          configuration: ['statement_timeout=8s'],
        },
      ],
      memberships: [
        { role: 'authenticated', member: 'authenticator', adminOption: false },
      ],
    }
    expect(fingerprintRolePolicy(rolePolicy)).toMatch(/^[0-9a-f]{64}$/)
    expect(() => fingerprintRolePolicy(rolePolicy.roles)).toThrow(
      'role policy evidence is invalid',
    )
    expect(buildRolePolicySql()).toMatch(/pg_catalog\.pg_roles/)
    expect(buildRolePolicySql()).toMatch(/pg_catalog\.pg_auth_members/)
    expect(buildRolePolicySql()).not.toMatch(/password/iu)
    expect(buildServerIdentitySql()).toMatch(/system_identifier/)
    expect(buildServerIdentitySql()).toMatch(/pg_catalog\.pg_database/)
  })

  it('restores roles only for a differing policy on a different server', () => {
    expect(roleRestoreRequired(hashA, hashA, true)).toBe(false)
    expect(roleRestoreRequired(hashA, hashA, false)).toBe(false)
    expect(roleRestoreRequired(hashA, hashB, false)).toBe(true)
    expect(() => roleRestoreRequired(hashA, hashB, true)).toThrow(
      'Same-server disposable target role policy differs',
    )
  })

  it('derives the deterministic data-dump scope from the relation contract', () => {
    expect(
      criticalRelationSchemas({
        relations: [
          { relation: 'public.orders' },
          { relation: 'private.audit_log' },
          { relation: 'public.positions' },
        ],
      }),
    ).toEqual(['private', 'public'])
    expect(() => criticalRelationSchemas({ relations: [] })).toThrow(
      'schema scope is invalid',
    )
  })

  it('decomposes a loopback URL into explicit libpq fields without a URI', () => {
    const parsed = postgresUrlToLibpqEnv(
      'postgresql://postgres:p%40ss@127.0.0.1:54322/capital_lab',
      { localOnly: true },
    )
    expect(parsed.libpqEnv).toEqual({
      PGDATABASE: 'capital_lab',
      PGHOST: '127.0.0.1',
      PGPASSWORD: 'p@ss',
      PGPORT: '54322',
      PGSSLMODE: 'disable',
      PGUSER: 'postgres',
    })
  })

  it('requires verify-full for non-loopback sources', () => {
    expect(() =>
      postgresUrlToLibpqEnv(
        'postgresql://operator:password@db.example.com/capital_lab',
      ),
    ).toThrow('target or TLS policy')
    expect(
      postgresUrlToLibpqEnv(
        'postgresql://operator:password@db.example.com/capital_lab?sslmode=verify-full',
      ).libpqEnv.PGSSLMODE,
    ).toBe('verify-full')
  })

  it('rejects fragments and non-allowlisted connection parameters', () => {
    expect(() =>
      postgresUrlToLibpqEnv(
        'postgresql://postgres:postgres@127.0.0.1:54322/postgres#fragment',
      ),
    ).toThrow('target or TLS policy')
    expect(() =>
      postgresUrlToLibpqEnv(
        'postgresql://postgres:postgres@127.0.0.1:54322/postgres?application_name=unsafe',
      ),
    ).toThrow('target or TLS policy')
  })

  it('redacts PostgreSQL literals and URLs from failure evidence', () => {
    expect(
      redactedPostgresError(
        "psql: error: invalid value 'sensitive' at postgresql://user:password@db.example.com/db",
      ),
    ).toBe("psql: error: invalid value '[redacted-literal]' at [redacted-url]")
  })

  it('rejects HEAD, migration checksum, and relation-set drift', () => {
    expect(() => assertBackupManifest(manifest, expected)).not.toThrow()
    expect(() =>
      assertBackupManifest(
        { ...manifest, gitCommitSha: 'd'.repeat(40) },
        expected,
      ),
    ).toThrow(/mismatch/)
    expect(() =>
      assertBackupManifest(manifest, {
        ...expected,
        migrations: [{ ...migrations[0], sha256: hashB }],
      }),
    ).toThrow(/mismatch/)
    expect(() =>
      assertBackupManifest(
        {
          ...manifest,
          relations: {
            'private.paid_canary_runs': relations['private.paid_canary_runs'],
          },
        },
        expected,
      ),
    ).toThrow(/mismatch/)
    expect(() =>
      assertBackupManifest(
        {
          ...manifest,
          artifacts: { ...manifest.artifacts, historyData: undefined },
        },
        expected,
      ),
    ).toThrow(/artifact_metadata/)
    expect(() =>
      assertBackupManifest(
        { ...manifest, dataSchemas: ['private', 'storage'] },
        expected,
      ),
    ).toThrow(/data_schemas/)
    expect(() =>
      assertBackupManifest(
        {
          ...manifest,
          artifacts: {
            ...manifest.artifacts,
            historyData: {
              ...manifest.artifacts.historyData,
              file: manifest.artifacts.data.file,
            },
          },
        },
        expected,
      ),
    ).toThrow(/artifact_metadata/)
  })

  it('rejects a database primary key that differs from the contract', () => {
    const contract = {
      relations: [
        {
          relation: 'private.no_ai_shadow_dry_runs',
          primaryKey: ['id'],
        },
      ],
    }
    expect(() =>
      assertContractKeys(contract, {
        catalogRelations: ['private.no_ai_shadow_dry_runs'],
        relations,
      }),
    ).not.toThrow()
    expect(() =>
      assertContractKeys(contract, {
        catalogRelations: ['private.no_ai_shadow_dry_runs'],
        relations: {
          ...relations,
          'private.no_ai_shadow_dry_runs': {
            ...relations['private.no_ai_shadow_dry_runs'],
            primaryKey: ['owner_id', 'id'],
          },
        },
      }),
    ).toThrow('primary key differs')
    expect(() =>
      assertContractKeys(contract, {
        catalogRelations: [
          'private.no_ai_shadow_dry_runs',
          'public.unclassified_relation',
        ],
        relations,
      }),
    ).toThrow('base-relation set differs')
  })

  it.each([
    ['Canary one-shot evidence', 'private.paid_canary_runs', 'contentSha256'],
    ['dry-run evidence', 'private.no_ai_shadow_dry_runs', 'contentSha256'],
    [
      'previously omitted column',
      'private.no_ai_shadow_dry_runs',
      'columnSignatureSha256',
    ],
  ])('rejects changed %s', (_label, relation, field) => {
    const actual = structuredClone({
      contractKind: manifest.contractKind,
      catalogRelations: Object.keys(relations).sort(),
      relations,
      appliedMigrations: manifest.source.appliedMigrations,
      relationSetSha256: manifest.relationSetSha256,
      schemaEvidence,
      schemaFingerprintSha256: manifest.schemaFingerprintSha256,
      migrationHistorySha256: manifest.source.migrationHistorySha256,
    }) as {
      contractKind: string
      relations: Record<string, Record<string, unknown>>
      appliedMigrations: Array<{ version: string; name: string }>
      relationSetSha256: string
      schemaFingerprintSha256: string
    }
    actual.relations[relation]![field] = 'f'.repeat(64)
    expect(() => assertRestoredEvidence(manifest, actual)).toThrow(/differs/)
  })

  it('rejects applied migration drift after restore', () => {
    expect(() =>
      assertRestoredEvidence(manifest, {
        contractKind: manifest.contractKind,
        catalogRelations: Object.keys(relations).sort(),
        relations,
        appliedMigrations: [{ version: '20260809150417', name: 'tampered' }],
        relationSetSha256: manifest.relationSetSha256,
        schemaEvidence,
        schemaFingerprintSha256: manifest.schemaFingerprintSha256,
        migrationHistorySha256: manifest.source.migrationHistorySha256,
      }),
    ).toThrow(/differs/)
  })

  it('rejects common-mode schema drift even when the database fingerprint is copied', () => {
    expect(() =>
      assertRestoredEvidence(manifest, {
        contractKind: manifest.contractKind,
        catalogRelations: Object.keys(relations).sort(),
        relations,
        appliedMigrations: manifest.source.appliedMigrations,
        relationSetSha256: manifest.relationSetSha256,
        schemaEvidence: {
          schemas: [{ name: 'same-drift-in-source-and-target' }],
        },
        schemaFingerprintSha256: manifest.schemaFingerprintSha256,
        migrationHistorySha256: manifest.source.migrationHistorySha256,
      }),
    ).toThrow(/differs/)
  })

  it.each([
    [
      'additional column',
      (evidence: typeof schemaEvidence) =>
        evidence.columns.push({
          schema: 'private',
          relation: 'example',
          name: 'extra',
          type: 'text',
          default: "'extra'::text",
        }),
    ],
    [
      'deleted column',
      (evidence: typeof schemaEvidence) => evidence.columns.splice(0, 1),
    ],
    [
      'changed type or default',
      (evidence: typeof schemaEvidence) => {
        evidence.columns[0]!.type = 'text'
        evidence.columns[0]!.default = "'drift'::text"
      },
    ],
    [
      'changed foreign key',
      (evidence: typeof schemaEvidence) => {
        evidence.constraints[0]!.definition =
          'FOREIGN KEY (owner_id) REFERENCES auth.users(id)'
      },
    ],
    [
      'disabled RLS',
      (evidence: typeof schemaEvidence) => {
        evidence.rowSecurity[0]!.enabled = false
      },
    ],
    [
      'changed policy predicate',
      (evidence: typeof schemaEvidence) => {
        evidence.policies[0]!.using = 'true'
      },
    ],
    [
      'unexpected grant',
      (evidence: typeof schemaEvidence) => {
        evidence.tableGrants[0]!.grantee = 'anon'
      },
    ],
    [
      'changed function body or search_path',
      (evidence: typeof schemaEvidence) => {
        evidence.functions[0]!.definition =
          'CREATE FUNCTION private.example_guard() RETURNS trigger SET search_path TO public'
      },
    ],
    [
      'changed or removed trigger',
      (evidence: typeof schemaEvidence) => evidence.triggers.splice(0, 1),
    ],
  ])('rejects independent Golden drift: %s', (_label, mutate) => {
    const drifted = structuredClone(schemaEvidence)
    mutate(drifted)
    expect(() =>
      assertRestoredEvidence(manifest, {
        contractKind: manifest.contractKind,
        catalogRelations: Object.keys(relations).sort(),
        relations,
        appliedMigrations: manifest.source.appliedMigrations,
        relationSetSha256: manifest.relationSetSha256,
        schemaEvidence: drifted,
        schemaFingerprintSha256: manifest.schemaFingerprintSha256,
        migrationHistorySha256: manifest.source.migrationHistorySha256,
      }),
    ).toThrow(/differs/)
  })

  it('rejects Auth count or mapped-owner closure drift without exposing Auth rows', () => {
    expect(() =>
      assertRestoredAuthEvidence(manifest, manifest.authEvidence),
    ).not.toThrow()
    expect(() =>
      assertRestoredAuthEvidence(manifest, {
        ...manifest.authEvidence,
        userCount: '1',
      }),
    ).toThrow(/Auth user\/identity\/owner closure evidence differs/)
    for (const mutation of [
      { mappedApplicationOwnerCount: '0' },
      { mappedApplicationOwnerCount: '2' },
      { orphanApplicationOwnerCount: '1' },
      { orphanIdentityCount: '1' },
      { usersWithoutIdentityCount: '1' },
    ]) {
      const driftedManifest = {
        ...manifest,
        authEvidence: { ...manifest.authEvidence, ...mutation },
      }
      expect(() => assertBackupManifest(driftedManifest, expected)).toThrow(
        /auth_evidence/,
      )
    }
  })
})
