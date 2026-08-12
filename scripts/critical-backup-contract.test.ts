import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

import {
  assertBackupManifest,
  assertContractKeys,
  assertRestoredAuthEvidence,
  assertRestoredEvidence,
  buildRolePolicySql,
  buildServerIdentitySql,
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
const schemaEvidence = { schemas: [] }
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
    schemaVersion: 1,
    userCount: '2',
    mappedApplicationOwnerCount: '1',
    relationCounts: { users: '2', identities: '2' },
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
  schemaVersion: 6,
  schemaContractVersion: 'capital-lab-post_activation-backup-v6',
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
    expect(source).not.toMatch(/drop database/iu)
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

  it('rejects Auth count or mapped-owner closure drift without exposing Auth rows', () => {
    expect(() =>
      assertRestoredAuthEvidence(manifest, manifest.authEvidence),
    ).not.toThrow()
    expect(() =>
      assertRestoredAuthEvidence(manifest, {
        ...manifest.authEvidence,
        userCount: '1',
      }),
    ).toThrow(/Auth relation-count or owner-mapping evidence differs/)
  })
})
