import { describe, expect, it } from 'vitest'

import {
  buildLocalRollbackRehearsalClientStageMarkerPlan,
  buildLocalRollbackMigrationRehearsalFailureDiagnostic,
  buildLocalRollbackMigrationRehearsalSuccess,
  LOCAL_ROLLBACK_REHEARSAL_FAILURE_STATUS,
  LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN,
  LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PREFIX,
  LOCAL_ROLLBACK_REHEARSAL_SUCCESS_STATUS,
  localRollbackRehearsalStageMarkerPsqlCommand,
  localRollbackRehearsalStageMarkerFromClientIndex,
  parseLocalRollbackMigrationRehearsalFailureDiagnostic,
  parseLocalRollbackMigrationRehearsalSuccess,
  parseLocalRollbackRehearsalStageMarkers,
  requireLastLocalRollbackRehearsalStageMarker,
  requireLocalRollbackMigrationRehearsalFailureDiagnostic,
  requireLocalRollbackMigrationRehearsalSuccess,
  ROLLBACK_MIGRATION_BASENAMES,
  serializeLocalRollbackMigrationRehearsalFailureDiagnostic,
  serializeLocalRollbackMigrationRehearsalSuccess,
  serializeLocalRollbackRehearsalStageMarker,
  validateLocalRollbackMigrationRehearsalFailureDiagnostic,
  validateLocalRollbackMigrationRehearsalSuccess,
  validateLocalRollbackRehearsalStageMarker,
} from './lib/local-rollback-rehearsal-diagnostic.mjs'

const commitSha = 'a'.repeat(40)
const migrationSetSha256 = 'b'.repeat(64)

function normalFailure(
  marker: (typeof LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN)[number],
) {
  return buildLocalRollbackMigrationRehearsalFailureDiagnostic({
    ...marker,
    psqlExitCode: 1,
    sqlstate: '42P01',
    signal: null,
    timedOut: false,
  })
}

function success() {
  return buildLocalRollbackMigrationRehearsalSuccess({
    commitSha,
    migrationSetSha256,
  })
}

function withoutKey(value: object, key: string) {
  return Object.fromEntries(
    Object.entries(value).filter(([name]) => name !== key),
  )
}

function unicodeEscapeAsciiIdentifier(value: string) {
  return [...value]
    .map(
      (character) =>
        `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
    )
    .join('')
}

describe('local rollback rehearsal client stage markers', () => {
  it('defines the exact immutable forward plan', () => {
    expect(ROLLBACK_MIGRATION_BASENAMES).toEqual([
      '20260809150000_post_build_hosting_safety.sql',
      '20260809150417_activation_readiness_follow_up.sql',
      '20260812092043_fourth_activation_readiness_remediation.sql',
      '20260812140953_fourth_activation_readiness_review_closure.sql',
    ])
    expect(LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN).toEqual([
      {
        stage: 'history_baseline',
        migrationBasename: null,
        completedMigrationCount: 0,
      },
      ...ROLLBACK_MIGRATION_BASENAMES.map(
        (migrationBasename, completedMigrationCount) => ({
          stage: 'migration_body',
          migrationBasename,
          completedMigrationCount,
        }),
      ),
      {
        stage: 'probe',
        migrationBasename: null,
        completedMigrationCount: 4,
      },
      {
        stage: 'rollback_verification',
        migrationBasename: null,
        completedMigrationCount: 4,
      },
    ])
    expect(Object.isFrozen(ROLLBACK_MIGRATION_BASENAMES)).toBe(true)
    expect(Object.isFrozen(LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN)).toBe(
      true,
    )
    expect(
      LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN.every(Object.isFrozen),
    ).toBe(true)
  })

  it('serializes only fixed single-line psql client commands', () => {
    for (const [
      index,
      marker,
    ] of LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN.entries()) {
      const serialized = serializeLocalRollbackRehearsalStageMarker(marker)
      expect(serialized).toBe(
        `${LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PREFIX}${index}:${marker.stage}:${marker.completedMigrationCount}:${marker.migrationBasename ?? '-'}\n`,
      )
      expect(localRollbackRehearsalStageMarkerPsqlCommand(marker)).toBe(
        `\\warn ${serialized}`,
      )
      expect(serialized.trim().split(/\r?\n/u)).toHaveLength(1)
    }
  })

  it('provides exact wrapper plans and maps their relative last index', () => {
    const baseline = buildLocalRollbackRehearsalClientStageMarkerPlan({
      expectedStartIndex: 0,
    })
    const rehearsal = buildLocalRollbackRehearsalClientStageMarkerPlan({
      expectedStartIndex: 1,
    })
    expect(baseline.prefix).toBe(
      'CAPITAL_LAB_CLIENT_STAGE_MARKER:ROLLBACK_REHEARSAL:',
    )
    expect(baseline.markers).toEqual([
      serializeLocalRollbackRehearsalStageMarker(
        LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN[0],
      ).trimEnd(),
    ])
    expect(rehearsal.markers).toEqual(
      LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN.slice(1).map((marker) =>
        serializeLocalRollbackRehearsalStageMarker(marker).trimEnd(),
      ),
    )
    expect(Object.isFrozen(baseline)).toBe(true)
    expect(Object.isFrozen(baseline.markers)).toBe(true)
    expect(
      localRollbackRehearsalStageMarkerFromClientIndex(0, {
        expectedStartIndex: 1,
      }),
    ).toEqual(LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN[1])
    expect(
      localRollbackRehearsalStageMarkerFromClientIndex(5, {
        expectedStartIndex: 1,
      }),
    ).toEqual(LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN[6])
    expect(() =>
      localRollbackRehearsalStageMarkerFromClientIndex(1, {
        expectedStartIndex: 0,
      }),
    ).toThrow(/index is invalid/u)
    for (const index of [-1, 1.5, 6]) {
      expect(() =>
        localRollbackRehearsalStageMarkerFromClientIndex(index, {
          expectedStartIndex: 1,
        }),
      ).toThrow(/index is invalid/u)
    }
  })

  it('accepts only the baseline prefix or the rehearsal forward prefix', () => {
    const baseline = serializeLocalRollbackRehearsalStageMarker(
      LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN[0],
    )
    expect(parseLocalRollbackRehearsalStageMarkers(baseline)).toEqual([
      LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN[0],
    ])
    expect(() =>
      parseLocalRollbackRehearsalStageMarkers(
        `${baseline}${serializeLocalRollbackRehearsalStageMarker(
          LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN[1],
        )}`,
      ),
    ).toThrow(/sequence is invalid/u)

    const rehearsalPlan = LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN.slice(1)
    for (let length = 0; length <= rehearsalPlan.length; length += 1) {
      const output = rehearsalPlan
        .slice(0, length)
        .map(serializeLocalRollbackRehearsalStageMarker)
        .join('')
      expect(
        parseLocalRollbackRehearsalStageMarkers(output, {
          expectedStartIndex: 1,
        }),
      ).toEqual(rehearsalPlan.slice(0, length))
    }
    expect(
      requireLastLocalRollbackRehearsalStageMarker(
        rehearsalPlan.map(serializeLocalRollbackRehearsalStageMarker).join(''),
        { expectedStartIndex: 1 },
      ),
    ).toEqual(rehearsalPlan.at(-1))
  })

  it('does not retain unrelated raw output or fake secrets', () => {
    const secret = [
      'postgresql',
      '://postgres:',
      'fake-password',
      '@127.0.0.1:59999/postgres',
    ].join('')
    const bearerSecret = [
      'Author',
      'ization: Bear',
      'er fake-stage-token',
    ].join('')
    const output = [
      `raw ${secret}`,
      serializeLocalRollbackRehearsalStageMarker(
        LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN[1],
      ).trim(),
      bearerSecret,
    ].join('\n')
    const parsed = parseLocalRollbackRehearsalStageMarkers(output, {
      expectedStartIndex: 1,
    })
    expect(parsed).toEqual([LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN[1]])
    expect(JSON.stringify(parsed)).not.toContain(secret)
    expect(JSON.stringify(parsed)).not.toContain('fake-stage-token')
  })

  it.each([
    [
      'duplicate',
      [
        LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN[1],
        LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN[1],
      ],
    ],
    [
      'backward',
      [
        LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN[2],
        LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN[1],
      ],
    ],
    [
      'missing',
      [
        LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN[1],
        LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN[3],
      ],
    ],
  ])('rejects a %s marker sequence', (_label, markers) => {
    expect(() =>
      parseLocalRollbackRehearsalStageMarkers(
        markers.map(serializeLocalRollbackRehearsalStageMarker).join(''),
        { expectedStartIndex: 1 },
      ),
    ).toThrow(/sequence is invalid/u)
  })

  it.each([
    `${LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PREFIX}99:probe:4:-\n`,
    `${LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PREFIX}01:migration_body:0:${ROLLBACK_MIGRATION_BASENAMES[0]}\n`,
    `${LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PREFIX}1:migration_body:1:${ROLLBACK_MIGRATION_BASENAMES[0]}\n`,
    `${LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PREFIX}:1:migration_body\n`,
    `${LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PREFIX}1:migration_body:0:${ROLLBACK_MIGRATION_BASENAMES[0]}${'x'.repeat(513)}\n`,
  ])('rejects an unknown or malformed marker %#', (output) => {
    expect(() =>
      parseLocalRollbackRehearsalStageMarkers(output, {
        expectedStartIndex: 1,
      }),
    ).toThrow(/marker is invalid/u)
  })

  it('rejects missing markers, invalid parser context, and marker shape drift', () => {
    expect(() =>
      requireLastLocalRollbackRehearsalStageMarker('unrelated', {
        expectedStartIndex: 1,
      }),
    ).toThrow(/is missing/u)
    for (const options of [
      {},
      { expectedStartIndex: -1 },
      { expectedStartIndex: 2 },
      { expectedStartIndex: 7 },
      { expectedStartIndex: 1, raw: true },
    ]) {
      expect(() =>
        parseLocalRollbackRehearsalStageMarkers(
          '',
          options as {
            expectedStartIndex: number
          },
        ),
      ).toThrow(/context is invalid/u)
    }
    const marker = LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN[1]
    for (const invalid of [
      withoutKey(marker, 'stage'),
      { ...marker, raw: 'unsafe' },
      { ...marker, stage: 'migration' },
      { ...marker, completedMigrationCount: 1 },
      { ...marker, migrationBasename: ROLLBACK_MIGRATION_BASENAMES[1] },
    ]) {
      expect(() => validateLocalRollbackRehearsalStageMarker(invalid)).toThrow(
        /marker is invalid/u,
      )
    }
  })
})

describe('local rollback migration rehearsal failure diagnostic', () => {
  it.each(LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN)(
    'builds the exact $stage/$completedMigrationCount failure',
    (marker) => {
      const diagnostic = normalFailure(marker)
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
      expect(diagnostic).toEqual({
        schemaVersion: 1,
        status: LOCAL_ROLLBACK_REHEARSAL_FAILURE_STATUS,
        role: 'source',
        contract: 'pre',
        ...marker,
        psqlExitCode: 1,
        sqlstate: '42P01',
        signal: null,
        timedOut: false,
      })
    },
  )

  it('accepts a platform-sized positive safe psql exit code', () => {
    expect(
      buildLocalRollbackMigrationRehearsalFailureDiagnostic({
        ...LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN[5],
        psqlExitCode: 4_294_967_295,
        sqlstate: '42P01',
        signal: null,
        timedOut: false,
      }),
    ).toMatchObject({ psqlExitCode: 4_294_967_295, sqlstate: '42P01' })
  })

  it('roundtrips one canonical object while discarding raw child output', () => {
    const diagnostic = normalFailure(
      LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN[2],
    )
    const serialized =
      serializeLocalRollbackMigrationRehearsalFailureDiagnostic(diagnostic)
    expect(serialized).toBe(`${JSON.stringify(diagnostic)}\n`)
    const secret = [
      'postgresql',
      '://postgres:',
      'fake-password',
      '@127.0.0.1:59999/postgres',
    ].join('')
    const output = `raw ${secret}\n${serialized}token=fake-child-token\n`
    const parsed =
      requireLocalRollbackMigrationRehearsalFailureDiagnostic(output)
    expect(parsed).toEqual(diagnostic)
    expect(JSON.stringify(parsed)).not.toContain(secret)
    expect(JSON.stringify(parsed)).not.toContain('fake-child-token')
  })

  it.each([
    [
      'logical baseline validation failure',
      { psqlExitCode: null, sqlstate: null, signal: null, timedOut: false },
    ],
    [
      'signal failure',
      {
        psqlExitCode: null,
        sqlstate: null,
        signal: 'SIGTERM',
        timedOut: false,
      },
    ],
    [
      'timeout failure',
      { psqlExitCode: null, sqlstate: null, signal: null, timedOut: true },
    ],
    [
      'signalled timeout failure',
      {
        psqlExitCode: null,
        sqlstate: null,
        signal: 'SIGKILL',
        timedOut: true,
      },
    ],
  ])('allows SQLSTATE null only for a %s', (_label, processOutcome) => {
    expect(
      buildLocalRollbackMigrationRehearsalFailureDiagnostic({
        ...LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN[0],
        ...processOutcome,
      }),
    ).toMatchObject(processOutcome)
  })

  it('allows a completely null process outcome only at logical validation stages', () => {
    const processOutcome = {
      psqlExitCode: null,
      sqlstate: null,
      signal: null,
      timedOut: false,
    }
    expect(
      buildLocalRollbackMigrationRehearsalFailureDiagnostic({
        ...LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN[6],
        ...processOutcome,
      }),
    ).toMatchObject(processOutcome)

    for (const marker of LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN.slice(
      1,
      6,
    )) {
      expect(() =>
        buildLocalRollbackMigrationRehearsalFailureDiagnostic({
          ...marker,
          ...processOutcome,
        }),
      ).toThrow(/diagnostic is invalid/u)
    }
  })

  it.each(LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN)(
    'allows signal and timeout forms at $stage/$completedMigrationCount',
    (marker) => {
      expect(
        buildLocalRollbackMigrationRehearsalFailureDiagnostic({
          ...marker,
          psqlExitCode: null,
          sqlstate: null,
          signal: 'SIGTERM',
          timedOut: false,
        }),
      ).toMatchObject({ signal: 'SIGTERM', timedOut: false })
      expect(
        buildLocalRollbackMigrationRehearsalFailureDiagnostic({
          ...marker,
          psqlExitCode: null,
          sqlstate: null,
          signal: null,
          timedOut: true,
        }),
      ).toMatchObject({ signal: null, timedOut: true })
    },
  )

  it.each([
    ['missing SQLSTATE', { psqlExitCode: 1, sqlstate: null }],
    ['lowercase SQLSTATE', { psqlExitCode: 1, sqlstate: '42p01' }],
    ['short SQLSTATE', { psqlExitCode: 1, sqlstate: '42P0' }],
    ['long SQLSTATE', { psqlExitCode: 1, sqlstate: '42P010' }],
    ['multiple SQLSTATEs', { psqlExitCode: 1, sqlstate: '42P01 23505' }],
    ['non-string SQLSTATE', { psqlExitCode: 1, sqlstate: ['42P01'] }],
    ['SQLSTATE without psql exit', { psqlExitCode: null, sqlstate: '42P01' }],
    ['zero psql exit', { psqlExitCode: 0, sqlstate: '00000' }],
    ['negative psql exit', { psqlExitCode: -1, sqlstate: '42P01' }],
    ['fractional psql exit', { psqlExitCode: 1.5, sqlstate: '42P01' }],
    [
      'psql exit plus signal',
      { psqlExitCode: 1, sqlstate: null, signal: 'SIGTERM' },
    ],
    [
      'psql exit plus timeout',
      { psqlExitCode: 1, sqlstate: null, timedOut: true },
    ],
    ['unknown signal', { psqlExitCode: null, sqlstate: null, signal: 'term' }],
    [
      'non-Boolean timeout',
      { psqlExitCode: null, sqlstate: null, timedOut: 1 },
    ],
  ])('rejects %s', (_label, override) => {
    const input = Object.assign(
      {
        ...LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN[0],
        psqlExitCode: 1,
        sqlstate: '42P01',
        signal: null,
        timedOut: false,
      },
      override,
    )
    expect(() =>
      buildLocalRollbackMigrationRehearsalFailureDiagnostic(input),
    ).toThrow(/diagnostic is invalid/u)
  })

  it.each([
    ['history basename', 0, ROLLBACK_MIGRATION_BASENAMES[0]],
    ['history count', 1, null],
    ['migration basename', 0, ROLLBACK_MIGRATION_BASENAMES[1]],
    ['migration count', 1, ROLLBACK_MIGRATION_BASENAMES[0]],
    ['probe basename', 4, ROLLBACK_MIGRATION_BASENAMES[3]],
    ['probe count', 3, null],
  ])('rejects invalid %s invariants', (label, count, migrationBasename) => {
    const stage = label.startsWith('history')
      ? 'history_baseline'
      : label.startsWith('migration')
        ? 'migration_body'
        : 'probe'
    expect(() =>
      buildLocalRollbackMigrationRehearsalFailureDiagnostic({
        stage,
        migrationBasename,
        completedMigrationCount: count,
        psqlExitCode: 1,
        sqlstate: '42P01',
        signal: null,
        timedOut: false,
      }),
    ).toThrow(/diagnostic is invalid/u)
  })

  it('rejects missing, additional, malformed, duplicate, and noncanonical output', () => {
    const diagnostic = normalFailure(
      LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN[1],
    )
    const line = JSON.stringify(diagnostic)
    expect(
      parseLocalRollbackMigrationRehearsalFailureDiagnostic('unrelated'),
    ).toBeNull()
    expect(() =>
      requireLocalRollbackMigrationRehearsalFailureDiagnostic('unrelated'),
    ).toThrow(/is missing/u)
    for (const invalid of [
      withoutKey(diagnostic, 'stage'),
      { ...diagnostic, raw: 'unsafe' },
      { ...diagnostic, schemaVersion: 2 },
      { ...diagnostic, status: 'wrong' },
      { ...diagnostic, role: 'reference' },
      { ...diagnostic, contract: 'post' },
      { ...diagnostic, stage: 'migration' },
    ]) {
      expect(() =>
        validateLocalRollbackMigrationRehearsalFailureDiagnostic(invalid),
      ).toThrow(/diagnostic is invalid/u)
    }
    for (const output of [
      `${line}\n${line}`,
      JSON.stringify(diagnostic, null, 2),
      line.replace(
        LOCAL_ROLLBACK_REHEARSAL_FAILURE_STATUS,
        'local_rollback_migration_rehearsal_failure_observe\\u0064',
      ),
      JSON.stringify({ ...diagnostic, status: 'wrong' }),
      JSON.stringify(withoutKey(diagnostic, 'status')),
      JSON.stringify({ wrapper: diagnostic }),
      `{"status":"${LOCAL_ROLLBACK_REHEARSAL_FAILURE_STATUS}",`,
    ]) {
      expect(() =>
        parseLocalRollbackMigrationRehearsalFailureDiagnostic(output),
      ).toThrow()
    }
  })

  it('never copies a secret into a validation error', () => {
    const secret = ['Author', 'ization: Bear', 'er fake-rollback-secret'].join(
      '',
    )
    let caught: unknown
    try {
      parseLocalRollbackMigrationRehearsalFailureDiagnostic(
        `${secret}\n{"status":"${LOCAL_ROLLBACK_REHEARSAL_FAILURE_STATUS}",`,
      )
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).not.toContain(secret)
    expect(JSON.stringify(caught)).not.toContain(secret)
    expect((caught as Error).cause).toBeUndefined()
  })

  it('fails closed before scanning oversized raw output', () => {
    expect(() =>
      parseLocalRollbackMigrationRehearsalFailureDiagnostic('x'.repeat(65_537)),
    ).toThrow(/failure diagnostic output is invalid/u)
  })

  it('rejects canonical success followed by an unterminated escaped failure status', () => {
    const canonicalSuccess = JSON.stringify(success())
    for (const escapedStatus of [
      'local_rollback_migration_rehearsal_failure_observe\\u0064',
      unicodeEscapeAsciiIdentifier(LOCAL_ROLLBACK_REHEARSAL_FAILURE_STATUS),
    ]) {
      const output = `${canonicalSuccess}\n{"statu\\u0073":"${escapedStatus}`
      expect(() =>
        parseLocalRollbackMigrationRehearsalFailureDiagnostic(output),
      ).toThrow(/failure diagnostic output is invalid/u)
    }
  })
})

describe('local rollback migration rehearsal success output', () => {
  it('validates the exact existing canonical success object', () => {
    const value = success()
    expect(Object.keys(value)).toEqual([
      'commitSha',
      'migrationCount',
      'migrationSetSha256',
      'status',
    ])
    expect(value).toEqual({
      commitSha,
      migrationCount: 4,
      migrationSetSha256,
      status: LOCAL_ROLLBACK_REHEARSAL_SUCCESS_STATUS,
    })
    expect(
      validateLocalRollbackMigrationRehearsalSuccess(value, {
        expectedCommitSha: commitSha,
        expectedMigrationSetSha256: migrationSetSha256,
      }),
    ).toEqual(value)
    expect(serializeLocalRollbackMigrationRehearsalSuccess(value)).toBe(
      `${JSON.stringify(value)}\n`,
    )
  })

  it('parses only one canonical success and discards raw streams', () => {
    const value = success()
    const secret = 'token=fake-success-secret'
    const output = `raw ${secret}\n${JSON.stringify(value)}\ntrailing raw\n`
    const parsed = requireLocalRollbackMigrationRehearsalSuccess(output, {
      expectedCommitSha: commitSha,
      expectedMigrationSetSha256: migrationSetSha256,
    })
    expect(parsed).toEqual(value)
    expect(JSON.stringify(parsed)).not.toContain(secret)
    expect(parseLocalRollbackMigrationRehearsalSuccess('unrelated')).toBeNull()
    expect(() =>
      requireLocalRollbackMigrationRehearsalSuccess('unrelated'),
    ).toThrow(/is missing/u)
  })

  it.each([
    withoutKey(success(), 'commitSha'),
    { ...success(), raw: 'unsafe' },
    { ...success(), commitSha: 'A'.repeat(40) },
    { ...success(), commitSha: { toString: () => commitSha } },
    { ...success(), migrationCount: 3 },
    { ...success(), migrationCount: '4' },
    { ...success(), migrationSetSha256: 'B'.repeat(64) },
    { ...success(), migrationSetSha256: [migrationSetSha256] },
    { ...success(), status: 'success' },
  ])('rejects success shape or type drift %#', (invalid) => {
    expect(() =>
      validateLocalRollbackMigrationRehearsalSuccess(invalid),
    ).toThrow(/success is invalid/u)
  })

  it('binds expected commit and migration-set identities', () => {
    const value = success()
    expect(() =>
      validateLocalRollbackMigrationRehearsalSuccess(value, {
        expectedCommitSha: 'c'.repeat(40),
      }),
    ).toThrow(/success is invalid/u)
    expect(() =>
      validateLocalRollbackMigrationRehearsalSuccess(value, {
        expectedMigrationSetSha256: 'd'.repeat(64),
      }),
    ).toThrow(/success is invalid/u)
    for (const context of [
      { expectedCommitSha: 'abc' },
      { expectedMigrationSetSha256: 'abc' },
      { expectedCommitSha: commitSha, raw: true },
    ]) {
      expect(() =>
        validateLocalRollbackMigrationRehearsalSuccess(value, context),
      ).toThrow(/context is invalid/u)
    }
  })

  it('rejects malformed, duplicate, shaped, or noncanonical success output', () => {
    const value = success()
    const line = JSON.stringify(value)
    for (const output of [
      `${line}\n${line}`,
      JSON.stringify(value, null, 2),
      line.replace('rollback_verified', 'rollback_verifie\\u0064'),
      JSON.stringify({ ...value, status: 'wrong' }),
      JSON.stringify(withoutKey(value, 'status')),
      JSON.stringify({ wrapper: value }),
      '{"status":"rollback_verified",',
    ]) {
      expect(() =>
        parseLocalRollbackMigrationRehearsalSuccess(output),
      ).toThrow()
    }
  })

  it('rejects canonical failure followed by an unterminated escaped success status', () => {
    const canonicalFailure = JSON.stringify(
      normalFailure(LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN[1]),
    )
    for (const escapedStatus of [
      'rollback_verifie\\u0064',
      unicodeEscapeAsciiIdentifier(LOCAL_ROLLBACK_REHEARSAL_SUCCESS_STATUS),
    ]) {
      const output = `${canonicalFailure}\n{"statu\\u0073":"${escapedStatus}`
      expect(() => parseLocalRollbackMigrationRehearsalSuccess(output)).toThrow(
        /success output is invalid/u,
      )
    }
  })
})
