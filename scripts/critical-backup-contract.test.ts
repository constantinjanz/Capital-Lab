import { describe, expect, it } from 'vitest'

import {
  assertBackupManifest,
  assertRestoredEvidence,
} from './critical-backup-contract.mjs'

const hashA = 'a'.repeat(64)
const hashB = 'b'.repeat(64)
const relations = {
  'private.no_ai_shadow_dry_runs': {
    rowCount: '1',
    contentSha256: hashA,
    columnCount: '10',
    columnSignatureSha256: hashB,
  },
  'private.paid_canary_runs': {
    rowCount: '3',
    contentSha256: hashB,
    columnCount: '9',
    columnSignatureSha256: hashA,
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
    schema: { file: 'schema.sql', sha256: hashA },
    data: { file: 'data.sql', sha256: hashA },
  },
  createdAt: '2026-08-10T00:00:00.000Z',
  schemaVersion: 2,
  schemaContractVersion: 'capital-lab-activation-backup-v2',
  gitCommitSha: 'c'.repeat(40),
  relationContractSha256: hashA,
  relations,
  migrations,
  source: {
    appliedMigrations: [{ version: '20260809150417', name: 'activation' }],
    databaseFingerprint: hashB,
    serverVersion: '170006',
  },
  toolVersions: {
    psql: 'psql (PostgreSQL) 17.6',
    supabase: '2.113.0',
  },
}
const expected = {
  gitCommitSha: 'c'.repeat(40),
  relationContractSha256: hashA,
  relationNames: Object.keys(relations).sort(),
  migrations,
}

describe('critical backup contract', () => {
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
      relations,
      appliedMigrations: manifest.source.appliedMigrations,
    }) as {
      relations: Record<string, Record<string, string>>
      appliedMigrations: Array<{ version: string; name: string }>
    }
    actual.relations[relation][field] = 'f'.repeat(64)
    expect(() => assertRestoredEvidence(manifest, actual)).toThrow(/differs/)
  })

  it('rejects applied migration drift after restore', () => {
    expect(() =>
      assertRestoredEvidence(manifest, {
        relations,
        appliedMigrations: [{ version: '20260809150417', name: 'tampered' }],
      }),
    ).toThrow(/differs/)
  })
})
