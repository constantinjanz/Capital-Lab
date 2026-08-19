import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

import {
  bootstrapLocalMigrationHistoryBoundary,
  EXPECTED_HISTORY_CONTRACT,
  HISTORY_BOOTSTRAP_SQL,
  HISTORY_CONTRACT_SQL,
  historyInsertSql,
  migrationContainerName,
  migrationIdentity,
  observeLocalMigrationReplayBoundary,
  parseLocalMigrationReplayOptions,
} from './apply-local-migrations-via-psql.mjs'
import { HISTORY_PREFLIGHT_SQL } from './lib/local-migration-replay-diagnostic.mjs'
import { canonicalReferenceProjectId } from './lib/owned-local-ci-stack.mjs'

const eligibleDiagnostic = {
  schemaVersion: 1,
  status: 'local_migration_replay_boundary_observed',
  stage: 'history_preflight',
  role: 'source',
  contract: 'pre',
  psqlQueryCompleted: true,
  historySchemaExists: false,
  historyRelationExists: false,
}

describe('checksummed local psql migration replay', () => {
  it('accepts only exact contract, seed and target arguments', () => {
    expect(
      parseLocalMigrationReplayOptions([
        '--contract=post',
        '--seed=include',
        '--target=ci',
      ]),
    ).toEqual({ contract: 'post', seed: 'include', target: 'ci' })
    expect(() =>
      parseLocalMigrationReplayOptions([
        '--contract=pre',
        '--seed=include',
        '--target=reference',
      ]),
    ).toThrow(/Exact contract/u)
    expect(() =>
      parseLocalMigrationReplayOptions([
        '--contract=post',
        '--seed=omit',
        '--target=ci',
        '--target=reference',
      ]),
    ).toThrow(/Exact contract/u)
  })

  it('derives only the exact run-owned CI or Reference container', () => {
    expect(migrationContainerName('ci', 'run-12345-1')).toBe(
      'supabase_db_capital-lab-ci-run-12345-1',
    )
    expect(migrationContainerName('reference', 'run-pre-a-12345-1')).toBe(
      `supabase_db_${canonicalReferenceProjectId('run-pre-a-12345-1')}`,
    )
    for (const value of ['run-x', 'pre-a-12345', 'run-pre-c-12345']) {
      expect(() => migrationContainerName('reference', value)).toThrow()
    }
  })

  it('derives only a canonical version and migration name', () => {
    expect(
      migrationIdentity('20260806164915_extensions_and_schemas.sql'),
    ).toEqual({ name: 'extensions_and_schemas', version: '20260806164915' })
    expect(() => migrationIdentity('20260806164915_bad;select.sql')).toThrow(
      /not canonical/u,
    )
  })

  it('records the exact reviewed file body after successful replay', () => {
    const sql = historyInsertSql(
      '20260806164915_extensions_and_schemas.sql',
      Buffer.from('begin;\nselect 1;\ncommit;\n'),
    )
    expect(sql).toContain("values ('20260806164915', 'extensions_and_schemas'")
    expect(sql).toContain('begin;\nselect 1;\ncommit;')
    expect(sql).not.toContain('on conflict')
  })

  it.each([
    ['source', 'pre'],
    ['source', 'post'],
    ['reference', 'pre'],
    ['reference', 'post'],
  ] as const)(
    'observes the completed %s/%s psql query',
    async (role, contract) => {
      const query = vi.fn().mockResolvedValue({
        schemaExists: false,
        relationExists: false,
      })
      const writes: string[] = []
      const diagnostic = await observeLocalMigrationReplayBoundary(
        role,
        contract,
        {
          query,
          write: (value: string) => {
            writes.push(value)
            return true
          },
        },
      )
      expect(query).toHaveBeenCalledExactlyOnceWith(role, HISTORY_PREFLIGHT_SQL)
      expect(writes).toEqual([`${JSON.stringify(diagnostic)}\n`])
      expect(diagnostic).toMatchObject({
        role,
        contract,
        psqlQueryCompleted: true,
        historySchemaExists: false,
        historyRelationExists: false,
      })
    },
  )

  it('emits no diagnosis when the psql query does not complete and parse', async () => {
    const secret = [
      'postgresql',
      '://postgres:',
      'fake-password',
      '@127.0.0.1/postgres',
    ].join('')
    const writes: string[] = []
    await expect(
      observeLocalMigrationReplayBoundary('source', 'pre', {
        query: async () => {
          throw new Error(secret)
        },
        write: (value: string) => {
          writes.push(value)
          return true
        },
      }),
    ).rejects.toThrow(secret)
    expect(writes).toEqual([])
  })

  it('defines the exact one-shot transactional history bootstrap SQL', () => {
    expect(HISTORY_BOOTSTRAP_SQL).toBe(`begin;
set local lock_timeout = '4s';

create schema supabase_migrations;

create table supabase_migrations.schema_migrations (
  version text not null primary key
);

alter table supabase_migrations.schema_migrations
  add column statements text[];

alter table supabase_migrations.schema_migrations
  add column name text;

commit;`)
    expect(Buffer.byteLength(HISTORY_BOOTSTRAP_SQL)).toBe(333)
    expect(
      createHash('sha256').update(HISTORY_BOOTSTRAP_SQL).digest('hex'),
    ).toBe('2600c289855bf6f2272fd42fd4bcaa254d3f8d68ab604a2348de26dddff23a71')
    expect(HISTORY_BOOTSTRAP_SQL.match(/\bbegin;/giu)).toHaveLength(1)
    expect(HISTORY_BOOTSTRAP_SQL.match(/\bcommit;/giu)).toHaveLength(1)
    expect(HISTORY_BOOTSTRAP_SQL).toContain("set local lock_timeout = '4s';")
    expect(HISTORY_BOOTSTRAP_SQL).not.toMatch(
      /if\s+not\s+exists|\b(?:cascade|drop|grant|owner|revoke)\b|row\s+level\s+security|\bpolicy\b|\bextension\b|seed_files/iu,
    )
    const positions = [
      'begin;',
      "set local lock_timeout = '4s';",
      'create schema supabase_migrations;',
      'create table supabase_migrations.schema_migrations',
      'add column statements text[];',
      'add column name text;',
      'commit;',
    ].map((statement) => HISTORY_BOOTSTRAP_SQL.indexOf(statement))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect([...positions].sort((left, right) => left - right)).toEqual(
      positions,
    )
  })

  it('keeps the strict history contract SQL byte-identical', () => {
    expect(Buffer.byteLength(HISTORY_CONTRACT_SQL)).toBe(1176)
    expect(
      createHash('sha256').update(HISTORY_CONTRACT_SQL).digest('hex'),
    ).toBe('8114a0c17e6e7fcc41f02362095d365f4f867ddade7cdfd25d185c5ef9da5f04')
  })

  it('bootstraps exactly once only after an eligible diagnosis', async () => {
    const events: string[] = []
    const execute = vi.fn(async (_role: string, sql: string) => {
      events.push('bootstrap')
      expect(sql).toBe(HISTORY_BOOTSTRAP_SQL)
    })
    const query = vi.fn(async (_role: string, sql: string) => {
      events.push('contract')
      expect(sql).toBe(HISTORY_CONTRACT_SQL)
      return EXPECTED_HISTORY_CONTRACT
    })
    await expect(
      bootstrapLocalMigrationHistoryBoundary('source', 'pre', {
        observe: async () => {
          events.push('probe')
          return eligibleDiagnostic
        },
        execute,
        query,
      }),
    ).resolves.toEqual(EXPECTED_HISTORY_CONTRACT)
    expect(events).toEqual(['probe', 'bootstrap', 'contract'])
    expect(execute).toHaveBeenCalledExactlyOnceWith(
      'source',
      HISTORY_BOOTSTRAP_SQL,
    )
    expect(query).toHaveBeenCalledExactlyOnceWith(
      'source',
      HISTORY_CONTRACT_SQL,
    )
  })

  it.each([
    [true, false],
    [false, true],
    [true, true],
  ] as const)(
    'stops existing history state %s/%s before DDL',
    async (historySchemaExists, historyRelationExists) => {
      const execute = vi.fn()
      const query = vi.fn()
      await expect(
        bootstrapLocalMigrationHistoryBoundary('source', 'pre', {
          observe: async () => ({
            ...eligibleDiagnostic,
            historySchemaExists,
            historyRelationExists,
          }),
          execute,
          query,
        }),
      ).rejects.toThrow(/not eligible/u)
      expect(execute).not.toHaveBeenCalled()
      expect(query).not.toHaveBeenCalled()
    },
  )

  it('stops malformed or context-drifted diagnosis before DDL', async () => {
    for (const diagnostic of [
      { ...eligibleDiagnostic, role: 'reference' },
      { ...eligibleDiagnostic, contract: 'post' },
      { ...eligibleDiagnostic, raw: 'unsafe' },
    ]) {
      const execute = vi.fn()
      const query = vi.fn()
      await expect(
        bootstrapLocalMigrationHistoryBoundary('source', 'pre', {
          observe: async () => diagnostic,
          execute,
          query,
        }),
      ).rejects.toThrow()
      expect(execute).not.toHaveBeenCalled()
      expect(query).not.toHaveBeenCalled()
    }
  })

  it('stops before the contract query when transactional DDL fails', async () => {
    const query = vi.fn()
    await expect(
      bootstrapLocalMigrationHistoryBoundary('source', 'pre', {
        observe: async () => eligibleDiagnostic,
        execute: async () => {
          throw new Error('synthetic DDL rollback')
        },
        query,
      }),
    ).rejects.toThrow(/synthetic DDL rollback/u)
    expect(query).not.toHaveBeenCalled()
  })

  it.each([
    [
      'column order',
      {
        ...EXPECTED_HISTORY_CONTRACT,
        columns: [...EXPECTED_HISTORY_CONTRACT.columns].reverse(),
      },
    ],
    [
      'declared type',
      {
        ...EXPECTED_HISTORY_CONTRACT,
        columns: EXPECTED_HISTORY_CONTRACT.columns.map((column, index) =>
          index === 0 ? { ...column, type: 'varchar' } : column,
        ),
      },
    ],
    [
      'array udt type',
      {
        ...EXPECTED_HISTORY_CONTRACT,
        columns: EXPECTED_HISTORY_CONTRACT.columns.map((column, index) =>
          index === 1 ? { ...column, type: 'text' } : column,
        ),
      },
    ],
    [
      'nullability',
      {
        ...EXPECTED_HISTORY_CONTRACT,
        columns: EXPECTED_HISTORY_CONTRACT.columns.map((column, index) =>
          index === 2 ? { ...column, nullable: 'NO' } : column,
        ),
      },
    ],
    [
      'primary key',
      { ...EXPECTED_HISTORY_CONTRACT, primaryKey: ['version', 'name'] },
    ],
    [
      'rows',
      {
        ...EXPECTED_HISTORY_CONTRACT,
        rows: [{ name: 'unexpected', version: '20260819000000' }],
      },
    ],
  ] as const)(
    'rejects an inexact post-DDL %s contract',
    async (_label, value) => {
      await expect(
        bootstrapLocalMigrationHistoryBoundary('source', 'pre', {
          observe: async () => eligibleDiagnostic,
          execute: async () => undefined,
          query: async () => value,
        }),
      ).rejects.toThrow(/not empty and exact/u)
    },
  )

  it('keeps identity, probe, eligibility, bootstrap, contract, and migration order', () => {
    const source = readFileSync(
      new URL('./apply-local-migrations-via-psql.mjs', import.meta.url),
      'utf8',
    )
    const identity = source.indexOf('inspectOwnedDatabaseContainer(role)')
    const boundary = source.indexOf(
      'bootstrapLocalMigrationHistoryBoundary(role, requested.contract)',
    )
    const probe = source.indexOf('const diagnostic = await observe(', 0)
    const eligibility = source.indexOf(
      'requireLocalMigrationReplayBootstrapEligibility(diagnostic',
      probe,
    )
    const bootstrap = source.indexOf(
      'await execute(role, HISTORY_BOOTSTRAP_SQL)',
      eligibility,
    )
    const history = source.indexOf(
      'await query(role, HISTORY_CONTRACT_SQL)',
      bootstrap,
    )
    const migration = source.indexOf(
      'for (const migration of contract.migrations)',
    )
    expect(identity).toBeGreaterThan(-1)
    expect(boundary).toBeGreaterThan(identity)
    expect(probe).toBeGreaterThan(-1)
    expect(eligibility).toBeGreaterThan(probe)
    expect(bootstrap).toBeGreaterThan(eligibility)
    expect(history).toBeGreaterThan(probe)
    expect(migration).toBeGreaterThan(boundary)
    expect(source).toContain("'--set=ON_ERROR_STOP=1'")
    expect(source).toContain(
      "process.stderr.write('Local migration replay failed closed.\\n')",
    )
    expect(source).toContain('process.exit(1)')
  })
})
