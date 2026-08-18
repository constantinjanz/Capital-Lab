import { readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

import {
  historyInsertSql,
  migrationContainerName,
  migrationIdentity,
  observeLocalMigrationReplayBoundary,
  parseLocalMigrationReplayOptions,
} from './apply-local-migrations-via-psql.mjs'
import { HISTORY_PREFLIGHT_SQL } from './lib/local-migration-replay-diagnostic.mjs'
import { canonicalReferenceProjectId } from './lib/owned-local-ci-stack.mjs'

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

  it('keeps identity inspection before the probe and the existing history contract after it', () => {
    const source = readFileSync(
      new URL('./apply-local-migrations-via-psql.mjs', import.meta.url),
      'utf8',
    )
    const identity = source.indexOf('inspectOwnedDatabaseContainer(role)')
    const probe = source.indexOf(
      'observeLocalMigrationReplayBoundary(role, requested.contract)',
    )
    const history = source.indexOf(
      'queryJson(role, HISTORY_CONTRACT_SQL)',
      probe,
    )
    expect(identity).toBeGreaterThan(-1)
    expect(probe).toBeGreaterThan(identity)
    expect(history).toBeGreaterThan(probe)
    expect(source.slice(probe, history)).not.toMatch(/inspectOwnedDatabase/u)
    expect(source).toContain(
      "process.stderr.write('Local migration replay failed closed.\\n')",
    )
    expect(source).toContain('process.exit(1)')
  })
})
