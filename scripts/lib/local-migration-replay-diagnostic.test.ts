import { describe, expect, it } from 'vitest'

import {
  buildLocalMigrationReplayFailureDiagnostic,
  buildLocalMigrationReplayDiagnostic,
  buildSchemaGoldenReferenceMigrationReplayFailureObservation,
  buildSchemaGoldenReferenceMigrationReplayObservation,
  HISTORY_PREFLIGHT_SQL,
  localMigrationReplayClientStageMarkerPlan,
  parseLocalMigrationReplayFailureDiagnostic,
  parseLocalMigrationReplayOutcome,
  parseLocalMigrationReplayDiagnostic,
  parseSchemaGoldenReferenceMigrationReplayOutcome,
  parseSchemaGoldenReferenceMigrationReplayObservations,
  requireLocalMigrationReplayDiagnostic,
  requireLocalMigrationReplayBootstrapEligibility,
  serializeLocalMigrationReplayFailureDiagnostic,
  serializeLocalMigrationReplayDiagnostic,
  serializeSchemaGoldenReferenceMigrationReplayFailureObservation,
  serializeSchemaGoldenReferenceMigrationReplayObservation,
  validateLocalMigrationReplayFailureDiagnostic,
  validateLocalMigrationReplayDiagnostic,
  validateSchemaGoldenReferenceMigrationReplayFailureObservation,
  validateSchemaGoldenReferenceMigrationReplayObservation,
  validateSchemaGoldenReferenceMigrationReplayObservationSequence,
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

const referenceDiagnostic = {
  ...expected,
  role: 'reference',
}
const migrationBasenames = [
  '20260801000000_first.sql',
  '20260801000001_second.sql',
  '20260801000002_third.sql',
]

function replayFailure(
  overrides: Record<string, unknown> = {},
  role: 'source' | 'reference' = 'reference',
  contract: 'pre' | 'post' = 'pre',
) {
  return buildLocalMigrationReplayFailureDiagnostic(
    {
      role,
      contract,
      stage: 'migration_apply',
      migrationBasename: migrationBasenames[1],
      completedMigrationCount: 1,
      psqlExitCode: 3,
      sqlstate: '42P01',
      signal: null,
      timedOut: false,
      ...overrides,
    },
    migrationBasenames,
  )
}

function referenceObservation(contract: 'pre' | 'post', replica: 'a' | 'b') {
  return buildSchemaGoldenReferenceMigrationReplayObservation({
    contract,
    replica,
    diagnostic: { ...referenceDiagnostic, contract },
  })
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
    [false, false, true],
    [true, false, false],
    [false, true, false],
    [true, true, false],
  ] as const)(
    'separately checks bootstrap eligibility for %s/%s',
    (historySchemaExists, historyRelationExists, eligible) => {
      const diagnostic = {
        ...expected,
        historySchemaExists,
        historyRelationExists,
      }
      if (eligible) {
        expect(
          requireLocalMigrationReplayBootstrapEligibility(diagnostic, {
            role: 'source',
            contract: 'pre',
          }),
        ).toEqual(diagnostic)
      } else {
        expect(() =>
          requireLocalMigrationReplayBootstrapEligibility(diagnostic, {
            role: 'source',
            contract: 'pre',
          }),
        ).toThrow(/not eligible/u)
      }
      expect(validateLocalMigrationReplayDiagnostic(diagnostic)).toEqual(
        diagnostic,
      )
    },
  )

  it('rejects bootstrap context drift and malformed diagnostics', () => {
    for (const context of [
      { role: 'reference', contract: 'pre' },
      { role: 'source', contract: 'post' },
    ]) {
      expect(() =>
        requireLocalMigrationReplayBootstrapEligibility(expected, context),
      ).toThrow(/not eligible/u)
    }
    expect(() =>
      requireLocalMigrationReplayBootstrapEligibility(
        { ...expected, raw: 'unsafe' },
        { role: 'source', contract: 'pre' },
      ),
    ).toThrow(/diagnostic is invalid/u)
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

  it('builds one exact canonical replica-bound Reference envelope', () => {
    const observation = referenceObservation('pre', 'a')
    expect(Object.keys(observation)).toEqual([
      'schemaVersion',
      'status',
      'contract',
      'replica',
      'localMigrationReplayDiagnostic',
    ])
    expect(observation).toEqual({
      schemaVersion: 1,
      status: 'schema_golden_reference_migration_replay_observed',
      contract: 'pre',
      replica: 'a',
      localMigrationReplayDiagnostic: referenceDiagnostic,
    })
    const serialized =
      serializeSchemaGoldenReferenceMigrationReplayObservation(observation)
    expect(serialized).toBe(`${JSON.stringify(observation)}\n`)
    expect(serialized.trim().split(/\r?\n/u)).toHaveLength(1)
    expect(
      parseSchemaGoldenReferenceMigrationReplayObservations(
        `untrusted\n${serialized}token=fake-secret`,
      ),
    ).toEqual([observation])
  })

  it.each([
    [
      'additional outer key',
      (value: ReturnType<typeof referenceObservation>) => ({
        ...value,
        raw: 'unsafe',
      }),
    ],
    [
      'wrong replica',
      (value: ReturnType<typeof referenceObservation>) => ({
        ...value,
        replica: 'c',
      }),
    ],
    [
      'outer and inner contract drift',
      (value: ReturnType<typeof referenceObservation>) => ({
        ...value,
        contract: 'post',
      }),
    ],
    [
      'nested non-Reference role',
      (value: ReturnType<typeof referenceObservation>) => ({
        ...value,
        localMigrationReplayDiagnostic: {
          ...value.localMigrationReplayDiagnostic,
          role: 'source',
        },
      }),
    ],
    [
      'nested existing schema',
      (value: ReturnType<typeof referenceObservation>) => ({
        ...value,
        localMigrationReplayDiagnostic: {
          ...value.localMigrationReplayDiagnostic,
          historySchemaExists: true,
        },
      }),
    ],
    [
      'nested existing relation',
      (value: ReturnType<typeof referenceObservation>) => ({
        ...value,
        localMigrationReplayDiagnostic: {
          ...value.localMigrationReplayDiagnostic,
          historyRelationExists: true,
        },
      }),
    ],
  ] as const)('rejects envelope %s', (_label, mutate) => {
    expect(() =>
      validateSchemaGoldenReferenceMigrationReplayObservation(
        mutate(referenceObservation('pre', 'a')),
      ),
    ).toThrow(/observation is invalid/u)
  })

  it('accepts only exact ordered prefixes of the four-build sequence', () => {
    const sequence = [
      referenceObservation('pre', 'a'),
      referenceObservation('pre', 'b'),
      referenceObservation('post', 'a'),
      referenceObservation('post', 'b'),
    ]
    for (let length = 0; length <= sequence.length; length += 1) {
      expect(
        validateSchemaGoldenReferenceMigrationReplayObservationSequence(
          sequence.slice(0, length),
        ),
      ).toEqual(sequence.slice(0, length))
    }
    for (const invalid of [
      [sequence[0], sequence[0]],
      [sequence[1], sequence[0]],
      [...sequence, sequence[3]],
    ]) {
      expect(() =>
        validateSchemaGoldenReferenceMigrationReplayObservationSequence(
          invalid,
        ),
      ).toThrow(/sequence is invalid/u)
    }
  })

  it('rejects malformed, non-canonical, duplicate, swapped, or fifth output', () => {
    const sequence = [
      referenceObservation('pre', 'a'),
      referenceObservation('pre', 'b'),
      referenceObservation('post', 'a'),
      referenceObservation('post', 'b'),
    ]
    const lines = sequence.map((value) => JSON.stringify(value))
    expect(() =>
      parseSchemaGoldenReferenceMigrationReplayObservations(
        JSON.stringify(sequence[0], null, 2),
      ),
    ).toThrow()
    expect(() =>
      parseSchemaGoldenReferenceMigrationReplayObservations(
        [lines[0], lines[0]].join('\n'),
      ),
    ).toThrow(/sequence is invalid/u)
    expect(() =>
      parseSchemaGoldenReferenceMigrationReplayObservations(
        [lines[1], lines[0]].join('\n'),
      ),
    ).toThrow(/sequence is invalid/u)
    expect(() =>
      parseSchemaGoldenReferenceMigrationReplayObservations(
        [...lines, lines[3]].join('\n'),
      ),
    ).toThrow(/sequence is invalid/u)
    const escapedStatus = lines[3].replace(
      'schema_golden_reference_migration_replay_observed',
      'schema_golden_reference_migration_replay_observe\\u0064',
    )
    expect(() =>
      parseSchemaGoldenReferenceMigrationReplayObservations(
        [...lines, escapedStatus].join('\n'),
      ),
    ).toThrow(/not canonical/u)
    for (const invalidStatus of ['wrong', undefined]) {
      const fifth = { ...sequence[3], status: invalidStatus }
      if (invalidStatus === undefined) delete fifth.status
      expect(() =>
        parseSchemaGoldenReferenceMigrationReplayObservations(
          [...lines, JSON.stringify(fifth)].join('\n'),
        ),
      ).toThrow(/output is invalid/u)
    }
    for (const malformed of [
      '{"replica":"b","localMigrationReplayDiagnostic":',
      '{"replic\\u0061":"b","localMigrationReplayDiagnosti\\u0063":',
      '{\n  "replica":"b",\n  "localMigrationReplayDiagnostic":\n}',
      '{\n  "status":"wrong",\n  "replica":"b",\n  "localMigrationReplayDiagnostic":\n}',
      '{\n  "localMigrationReplayDiagnostic": {},\n  "replica":"b"\n',
      '{\n  "noise":"\\u0022}",\n  "replica":"b",\n  "localMigrationReplayDiagnostic":null\n}',
      'noise "\n{\n  "replica":"b",\n  "localMigrationReplayDiagnostic":null\n}',
      'noise {"message":"unterminated\n{\n  "replica":"b",\n  "localMigrationReplayDiagnostic":null\n}',
      '{"status":"schema_golden_reference_migration_replay_observe\\u0064","localMigrationReplayDiagnostic":{\n',
      '{"status":"schema_golden_reference_migration_replay_observe\\u0064',
      '{"statu\\u0073":"schema_golden_reference_migration_replay_observe\\u0064',
      '{"wrapper":{"replica":"b","localMigrationReplayDiagnostic":null}}',
      '{"wrapper":{"status":"schema_golden_reference_migration_replay_observe\\u0064","localMigrationReplayDiagnostic":null}}',
    ]) {
      expect(() =>
        parseSchemaGoldenReferenceMigrationReplayObservations(
          [...lines, malformed].join('\n'),
        ),
      ).toThrow(/output is invalid/u)
    }
    expect(
      parseSchemaGoldenReferenceMigrationReplayObservations(
        [
          '{"status":"schema_goldens_reproducible","replica":"aggregate"}',
          '{"status":"unrelated","localMigrationReplayDiagnostic":null}',
          '{"message":"\\\"replica\\\": and \\\"localMigrationReplayDiagnostic\\\":"}',
          '{"note":"\\u0022","replica":"aggregate"}',
          '{"status":"another","localMigrationReplayDiagnostic":null}',
        ].join('\n'),
      ),
    ).toEqual([])
  })

  it.each([
    ['history_preflight', null, 0],
    ['history_bootstrap', null, 0],
    ['history_contract', null, 0],
    ['migration_apply', migrationBasenames[1], 1],
    ['history_insert', migrationBasenames[1], 1],
    ['final_history_contract', null, migrationBasenames.length],
  ] as const)(
    'roundtrips exact failure stage %s',
    (stage, migrationBasename, completedMigrationCount) => {
      const diagnostic = replayFailure({
        stage,
        migrationBasename,
        completedMigrationCount,
      })
      expect(Object.keys(diagnostic)).toEqual([
        'schemaVersion',
        'status',
        'role',
        'contract',
        'stage',
        'migrationBasename',
        'completedMigrationCount',
        'psqlExitCode',
        'sqlstate',
        'signal',
        'timedOut',
      ])
      const serialized = serializeLocalMigrationReplayFailureDiagnostic(
        diagnostic,
        migrationBasenames,
      )
      expect(serialized).toBe(`${JSON.stringify(diagnostic)}\n`)
      expect(
        parseLocalMigrationReplayFailureDiagnostic(
          `untrusted\n${stage === 'history_preflight' ? '' : `${JSON.stringify(referenceDiagnostic)}\n`}${serialized}token=fake-secret`,
          migrationBasenames,
        ),
      ).toEqual(diagnostic)
    },
  )

  it.each([
    [3, '42P01', null, false],
    [null, null, 'SIGTERM', false],
    [null, null, 'SIGKILL', true],
    [null, null, null, true],
  ] as const)(
    'accepts the sanitized process shape %#',
    (psqlExitCode, sqlstate, signal, timedOut) => {
      expect(
        replayFailure({ psqlExitCode, sqlstate, signal, timedOut }),
      ).toMatchObject({ psqlExitCode, sqlstate, signal, timedOut })
    },
  )

  it.each([
    ['history_preflight', 0],
    ['history_contract', 0],
    ['final_history_contract', migrationBasenames.length],
  ] as const)('accepts fixed logical failure stage %s', (stage, count) => {
    expect(
      replayFailure({
        stage,
        migrationBasename: null,
        completedMigrationCount: count,
        psqlExitCode: null,
        sqlstate: null,
        signal: null,
        timedOut: false,
      }),
    ).toMatchObject({ stage, completedMigrationCount: count })
  })

  it.each([
    [
      'history_bootstrap',
      { migrationBasename: null, completedMigrationCount: 0 },
    ],
    [
      'migration_apply',
      {
        migrationBasename: migrationBasenames[1],
        completedMigrationCount: 1,
      },
    ],
    [
      'history_insert',
      {
        migrationBasename: migrationBasenames[1],
        completedMigrationCount: 1,
      },
    ],
  ] as const)('rejects forgeable logical failure stage %s', (stage, fields) => {
    expect(() =>
      replayFailure({
        stage,
        ...fields,
        psqlExitCode: null,
        sqlstate: null,
        signal: null,
        timedOut: false,
      }),
    ).toThrow(/failure diagnostic is invalid/u)
  })

  it.each([
    ['unknown stage', { stage: 'seed' }],
    ['extra key', { raw: 'unsafe' }],
    ['wrong basename', { migrationBasename: migrationBasenames[0] }],
    ['path basename', { migrationBasename: 'C:/private/second.sql' }],
    ['missing basename', { migrationBasename: null }],
    ['wrong count', { completedMigrationCount: 2 }],
    ['zero exit', { psqlExitCode: 0 }],
    ['missing SQLSTATE', { sqlstate: null }],
    ['lowercase SQLSTATE', { sqlstate: '42p01' }],
    ['malformed SQLSTATE', { sqlstate: '42P0' }],
    ['success SQLSTATE', { sqlstate: '00000' }],
    ['exit and signal', { signal: 'SIGTERM' }],
    ['unknown signal', { psqlExitCode: null, sqlstate: null, signal: 'TERM' }],
  ])('rejects failure %s', (_label, overrides) => {
    const value = { ...replayFailure(), ...overrides }
    expect(() =>
      validateLocalMigrationReplayFailureDiagnostic(value, migrationBasenames),
    ).toThrow(/failure diagnostic is invalid/u)
  })

  it('builds one server-neutral, single-marker replay plan', () => {
    expect(
      localMigrationReplayClientStageMarkerPlan(
        {
          stage: 'migration_apply',
          migrationBasename: migrationBasenames[1],
          completedMigrationCount: 1,
        },
        migrationBasenames,
      ),
    ).toEqual({
      prefix: 'CAPITAL_LAB_CLIENT_STAGE_MARKER:MIGRATION_REPLAY:',
      markers: [
        'CAPITAL_LAB_CLIENT_STAGE_MARKER:MIGRATION_REPLAY:0|migration_apply|1|20260801000001_second.sql',
      ],
    })
  })

  it('requires Boundary before every post-preflight failure', () => {
    const boundary = { ...referenceDiagnostic, contract: 'pre' }
    const failure = replayFailure()
    const output = `${JSON.stringify(boundary)}\n${JSON.stringify(failure)}\n`
    expect(
      parseLocalMigrationReplayOutcome(output, migrationBasenames),
    ).toEqual({ boundary, failure })
    expect(() =>
      parseLocalMigrationReplayOutcome(
        JSON.stringify(failure),
        migrationBasenames,
      ),
    ).toThrow(/outcome is invalid/u)
    const preflight = replayFailure({
      stage: 'history_preflight',
      migrationBasename: null,
      completedMigrationCount: 0,
    })
    expect(
      parseLocalMigrationReplayOutcome(
        JSON.stringify(preflight),
        migrationBasenames,
      ),
    ).toEqual({ boundary: null, failure: preflight })
    expect(
      parseLocalMigrationReplayOutcome(
        `${JSON.stringify(boundary)}\n${JSON.stringify(preflight)}`,
        migrationBasenames,
      ),
    ).toEqual({ boundary, failure: preflight })
    expect(() =>
      parseLocalMigrationReplayOutcome(
        `${JSON.stringify(failure)}\n${JSON.stringify(boundary)}`,
        migrationBasenames,
      ),
    ).toThrow(/outcome is invalid/u)
  })

  it.each([
    [
      'typed scaffold without status or required fields',
      JSON.stringify({
        schemaVersion: 1,
        role: 'reference',
        contract: 'pre',
        stage: 'migration_apply',
      }),
    ],
    [
      'Boundary-like object without status',
      JSON.stringify({
        ...referenceDiagnostic,
        status: undefined,
      }),
    ],
    [
      'Failure-like object without status',
      JSON.stringify({ ...replayFailure(), status: undefined }),
    ],
    [
      'escaped typed keys',
      '{"schema\\u0056ersion":1,"r\\u006fle":"reference","contr\\u0061ct":"pre","st\\u0061ge":"migration_apply"}',
    ],
    [
      'multiline typed scaffold',
      JSON.stringify(
        {
          schemaVersion: 1,
          role: 'reference',
          contract: 'pre',
          stage: 'migration_apply',
        },
        null,
        2,
      ),
    ],
    [
      'nested typed scaffold',
      JSON.stringify({
        wrapper: {
          schemaVersion: 1,
          role: 'reference',
          contract: 'pre',
          stage: 'migration_apply',
        },
      }),
    ],
  ])('rejects malformed inner output: %s', (_label, malformed) => {
    expect(() =>
      parseLocalMigrationReplayOutcome(
        `${JSON.stringify(referenceDiagnostic)}\n${malformed}`,
        migrationBasenames,
      ),
    ).toThrow(/outcome is invalid/u)
  })

  it('binds one canonical Reference failure to contract and replica', () => {
    const diagnostic = replayFailure()
    const observation =
      buildSchemaGoldenReferenceMigrationReplayFailureObservation({
        contract: 'pre',
        replica: 'a',
        diagnostic,
        migrationBasenames,
      })
    expect(Object.keys(observation)).toEqual([
      'schemaVersion',
      'status',
      'contract',
      'replica',
      'localMigrationReplayFailureDiagnostic',
    ])
    expect(
      serializeSchemaGoldenReferenceMigrationReplayFailureObservation(
        observation,
        migrationBasenames,
      ),
    ).toBe(`${JSON.stringify(observation)}\n`)
    for (const invalid of [
      { ...observation, contract: 'post' },
      { ...observation, replica: 'c' },
      {
        ...observation,
        localMigrationReplayFailureDiagnostic: {
          ...diagnostic,
          role: 'source',
        },
      },
      { ...observation, raw: 'unsafe' },
    ]) {
      expect(() =>
        validateSchemaGoldenReferenceMigrationReplayFailureObservation(
          invalid,
          migrationBasenames,
        ),
      ).toThrow(/failure observation is invalid/u)
    }
  })

  it('accepts pre/a Boundary plus exactly one terminal bound failure', () => {
    const boundary = referenceObservation('pre', 'a')
    const failure = buildSchemaGoldenReferenceMigrationReplayFailureObservation(
      {
        contract: 'pre',
        replica: 'a',
        diagnostic: replayFailure(),
        migrationBasenames,
      },
    )
    const parsed = parseSchemaGoldenReferenceMigrationReplayOutcome(
      `${JSON.stringify(boundary)}\n${JSON.stringify(failure)}\n`,
      { pre: migrationBasenames, post: migrationBasenames },
    )
    expect(parsed).toEqual({
      observations: [boundary],
      failureObservation: failure,
    })
    expect(() =>
      parseSchemaGoldenReferenceMigrationReplayOutcome(
        `${JSON.stringify(boundary)}\n${JSON.stringify(failure)}\n${JSON.stringify(referenceObservation('pre', 'b'))}`,
        { pre: migrationBasenames, post: migrationBasenames },
      ),
    ).toThrow(/outcome is invalid/u)
    expect(() =>
      parseSchemaGoldenReferenceMigrationReplayOutcome(
        `${JSON.stringify(boundary)}\n${JSON.stringify(failure)}\n${JSON.stringify(failure)}`,
        { pre: migrationBasenames, post: migrationBasenames },
      ),
    ).toThrow(/outcome is invalid/u)
  })

  it('keeps the successful four-Boundary Reference path unchanged', () => {
    const sequence = [
      referenceObservation('pre', 'a'),
      referenceObservation('pre', 'b'),
      referenceObservation('post', 'a'),
      referenceObservation('post', 'b'),
    ]
    expect(
      parseSchemaGoldenReferenceMigrationReplayOutcome(
        sequence.map((value) => JSON.stringify(value)).join('\n'),
        { pre: migrationBasenames, post: migrationBasenames },
      ),
    ).toEqual({ observations: sequence, failureObservation: null })
  })

  it('rejects a fifth malformed outer envelope in canonical and legacy parsers', () => {
    const sequence = [
      referenceObservation('pre', 'a'),
      referenceObservation('pre', 'b'),
      referenceObservation('post', 'a'),
      referenceObservation('post', 'b'),
    ]
    const boundary = sequence[3]
    const failure = buildSchemaGoldenReferenceMigrationReplayFailureObservation(
      {
        contract: 'post',
        replica: 'b',
        diagnostic: replayFailure({}, 'reference', 'post'),
        migrationBasenames,
      },
    )
    const malformed = [
      JSON.stringify({ schemaVersion: 1, contract: 'post', replica: 'b' }),
      JSON.stringify({ ...boundary, status: undefined }),
      JSON.stringify({ ...failure, status: undefined }),
      JSON.stringify({
        schemaVersion: 1,
        status: 'schema_golden_reference_migration_replay_observed',
        contract: 'post',
        replica: 'b',
      }),
      JSON.stringify({
        schemaVersion: 1,
        status: 'schema_golden_reference_migration_replay_failure_observed',
        contract: 'post',
        replica: 'b',
      }),
      '{"schema\\u0056ersion":1,"contr\\u0061ct":"post","replic\\u0061":"b"}',
      JSON.stringify(
        { schemaVersion: 1, contract: 'post', replica: 'b' },
        null,
        2,
      ),
      JSON.stringify({
        wrapper: { schemaVersion: 1, contract: 'post', replica: 'b' },
      }),
      JSON.stringify({
        wrapper: {
          contract: 'post',
          replica: 'b',
          localMigrationReplayFailureDiagnostic: {},
        },
      }),
    ]
    const prefix = sequence.map((value) => JSON.stringify(value)).join('\n')
    for (const candidate of malformed) {
      const output = `${prefix}\n${candidate}`
      expect(() =>
        parseSchemaGoldenReferenceMigrationReplayOutcome(output, {
          pre: migrationBasenames,
          post: migrationBasenames,
        }),
      ).toThrow()
      expect(() =>
        parseSchemaGoldenReferenceMigrationReplayObservations(output),
      ).toThrow()
    }
  })
})
