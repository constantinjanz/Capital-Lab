import { describe, expect, it } from 'vitest'

import { extractRollbackMigrationBody } from './migration-rehearsal-contract.mjs'

describe('rollback migration rehearsal contract', () => {
  it('extracts only a single explicit outer transaction', () => {
    expect(
      extractRollbackMigrationBody(
        'begin;\ncreate table private.probe(id bigint);\ncommit;\n',
        '20260809150417_probe.sql',
      ),
    ).toContain('create table private.probe')
  })

  it.each([
    'create table private.probe(id bigint);',
    'begin;\nselect 1;\ncommit;\ncommit;',
    'begin;\nselect 1;\nrollback;',
  ])('rejects an unsafe transaction shape', (sql) => {
    expect(() =>
      extractRollbackMigrationBody(sql, '20260809150417_probe.sql'),
    ).toThrow('exactly one outer BEGIN/COMMIT pair')
  })
})
