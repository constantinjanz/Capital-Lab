import { describe, expect, it } from 'vitest'

import {
  historyInsertSql,
  migrationContainerName,
  migrationIdentity,
  parseLocalMigrationReplayOptions,
} from './apply-local-migrations-via-psql.mjs'

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
      'supabase_db_capital-lab-reference-run-pre-a-12345-1',
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
})
