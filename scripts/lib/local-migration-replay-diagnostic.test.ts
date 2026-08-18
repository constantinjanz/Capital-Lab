import { describe, expect, it } from 'vitest'

import {
  buildLocalMigrationReplayDiagnostic,
  HISTORY_PREFLIGHT_SQL,
  parseLocalMigrationReplayDiagnostic,
  requireLocalMigrationReplayDiagnostic,
  serializeLocalMigrationReplayDiagnostic,
  validateLocalMigrationReplayDiagnostic,
} from './local-migration-replay-diagnostic.mjs'

const expected = {
  schemaVersion: 1,
  status: 'local_migration_replay_boundary_observed',
  stage: 'history_preflight',
  role: 'source',
  contract: 'pre',
  psqlQueryCompleted: true,
  historySchemaExists: false,
  historyRelationExists: false,
}

describe('local migration replay boundary diagnostic', () => {
  it.each([
    ['source', 'pre', false, false],
    ['source', 'post', true, false],
    ['reference', 'pre', false, true],
    ['reference', 'post', true, true],
  ] as const)(
    'roundtrips exact %s/%s evidence',
    (role, contract, schemaExists, relationExists) => {
      const diagnostic = buildLocalMigrationReplayDiagnostic({
        role,
        contract,
        queryResult: { schemaExists, relationExists },
      })
      expect(
        parseLocalMigrationReplayDiagnostic(
          serializeLocalMigrationReplayDiagnostic(diagnostic),
        ),
      ).toEqual({
        ...expected,
        role,
        contract,
        historySchemaExists: schemaExists,
        historyRelationExists: relationExists,
      })
    },
  )

  it.each([
    {},
    { schemaExists: false },
    { relationExists: false },
    { schemaExists: false, relationExists: false, rows: [] },
    { schemaExists: 'false', relationExists: false },
    { schemaExists: false, relationExists: 0 },
  ])('rejects an inexact query result %#', (queryResult) => {
    expect(() =>
      buildLocalMigrationReplayDiagnostic({
        role: 'source',
        contract: 'pre',
        queryResult,
      }),
    ).toThrow(/query result is invalid/u)
  })

  it.each([
    [
      'missing key',
      (value: typeof expected) =>
        Object.fromEntries(
          Object.entries(value).filter(
            ([key]) => key !== 'historyRelationExists',
          ),
        ),
    ],
    [
      'additional key',
      (value: typeof expected) => ({ ...value, raw: 'private' }),
    ],
    [
      'wrong schema version',
      (value: typeof expected) => ({ ...value, schemaVersion: 2 }),
    ],
    [
      'wrong status',
      (value: typeof expected) => ({ ...value, status: 'observed' }),
    ],
    [
      'wrong stage',
      (value: typeof expected) => ({ ...value, stage: 'history' }),
    ],
    ['wrong role', (value: typeof expected) => ({ ...value, role: 'restore' })],
    [
      'wrong contract',
      (value: typeof expected) => ({ ...value, contract: 'future' }),
    ],
    [
      'non-Boolean schema result',
      (value: typeof expected) => ({ ...value, historySchemaExists: 0 }),
    ],
    [
      'non-Boolean relation result',
      (value: typeof expected) => ({
        ...value,
        historyRelationExists: 'false',
      }),
    ],
    [
      'incomplete psql query',
      (value: typeof expected) => ({
        ...value,
        psqlQueryCompleted: false,
      }),
    ],
  ] as const)('rejects %s', (_label, mutate) => {
    expect(() =>
      validateLocalMigrationReplayDiagnostic(mutate(expected)),
    ).toThrow(/diagnostic is invalid/u)
  })

  it('extracts only one exact object from mixed child output', () => {
    const secret = [
      'postgresql',
      '://postgres:',
      'fake-password',
      '@127.0.0.1:59999/postgres',
    ].join('')
    const output = [
      `untrusted stdout ${secret}`,
      serializeLocalMigrationReplayDiagnostic(expected).trim(),
      `untrusted trailing output token=fake-token`,
    ].join('\n')
    const parsed = requireLocalMigrationReplayDiagnostic(output)
    expect(parsed).toEqual(expected)
    expect(Object.keys(parsed)).toEqual(Object.keys(expected))
    expect(JSON.stringify(parsed)).not.toContain(secret)
    expect(JSON.stringify(parsed)).not.toContain('fake-token')
  })

  it('rejects missing, duplicate, non-canonical, or oversized output', () => {
    const line = serializeLocalMigrationReplayDiagnostic(expected).trim()
    expect(parseLocalMigrationReplayDiagnostic('unrelated output')).toBeNull()
    expect(() => requireLocalMigrationReplayDiagnostic('unrelated')).toThrow(
      /is missing/u,
    )
    expect(() =>
      parseLocalMigrationReplayDiagnostic(`${line}\n${line}`),
    ).toThrow(/ambiguous/u)
    expect(() =>
      parseLocalMigrationReplayDiagnostic(JSON.stringify(expected, null, 2)),
    ).toThrow()
    expect(() =>
      parseLocalMigrationReplayDiagnostic(`${line}${' '.repeat(2049)}`),
    ).toThrow(/ambiguous/u)
  })

  it('defines only the exact read-only probe', () => {
    expect(HISTORY_PREFLIGHT_SQL).toBe(`select jsonb_build_object(
  'schemaExists',
  to_regnamespace('supabase_migrations') is not null,
  'relationExists',
  to_regclass('supabase_migrations.schema_migrations') is not null
);`)
    expect(HISTORY_PREFLIGHT_SQL).toMatch(/^select\b/iu)
    expect(HISTORY_PREFLIGHT_SQL).not.toMatch(
      /\b(?:alter|copy|create|delete|drop|grant|insert|revoke|truncate|update)\b/iu,
    )
  })
})
