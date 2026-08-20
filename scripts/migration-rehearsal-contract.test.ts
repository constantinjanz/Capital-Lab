import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import type { LocalContainerImageIdentityRejection } from './lib/local-container-identity-diagnostic.mjs'

import {
  buildLocalRollbackRehearsalClientStageMarkerPlan,
  LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN,
  LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PREFIX,
  parseLocalRollbackMigrationRehearsalFailureDiagnostic,
  ROLLBACK_MIGRATION_BASENAMES,
  serializeLocalRollbackRehearsalStageMarker,
} from './lib/local-rollback-rehearsal-diagnostic.mjs'
import { extractRollbackMigrationBody } from './migration-rehearsal-contract.mjs'
import {
  buildRollbackHistoryBaselineSql,
  buildRollbackMigrationRehearsalSql,
  buildRollbackRehearsalSuccessOutput,
  ROLLBACK_HISTORY_BASELINE_SQL,
  runRollbackDatabaseRehearsal,
} from './run-local-rollback-migration-rehearsal.mjs'

const runner = fileURLToPath(
  new URL('./run-local-rollback-migration-rehearsal.mjs', import.meta.url),
)
const migrationDirectory = fileURLToPath(
  new URL('../supabase/migrations/', import.meta.url),
)
const migrationHashes = [
  'ee9a1390a6cf1abfca9a8664d6dfe492bc217741265f2d0d5e8b010af6c0352e',
  '01e5b32ccc10581b272a31b91660854e6875241a88aa2893b3f1e185ef9dfb7d',
  '0385cf8d05b105766f43f2c5f0b2683696a3d0416cd79390fbdae97b2d0b23fa',
  'e8382eb73227eb4a227eb1036daaa7e7c1d5826f4234ee3f86516980f8f136fe',
]

function sha256(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

function actualMigrations() {
  return ROLLBACK_MIGRATION_BASENAMES.map((name, index) => {
    const bytes = readFileSync(path.join(migrationDirectory, name))
    expect(sha256(bytes)).toBe(migrationHashes[index])
    return {
      body: extractRollbackMigrationBody(bytes.toString('utf8'), name),
      name,
      sha256: sha256(bytes),
    }
  })
}

function fixtureMigrations() {
  return ROLLBACK_MIGRATION_BASENAMES.map((name, index) => ({
    body: `select ${index + 1} as migration_${index + 1};\n`,
    name,
    sha256: String(index).repeat(64),
  }))
}

function fixtureContract() {
  return {
    migrations: ROLLBACK_MIGRATION_BASENAMES.map((name) => ({
      name,
      version: name.slice(0, 14),
    })),
  }
}

function expectedHistory() {
  return fixtureContract().migrations.map(({ name, version }) => ({
    name: name.slice(15, -4),
    version,
  }))
}

function ownedFailure(overrides: Record<string, unknown> = {}) {
  return {
    owned: true,
    exitCode: 1,
    lastClientStageMarkerIndex: 0,
    signal: null,
    sqlstate: '42P01',
    timedOut: false,
    ...overrides,
  }
}

const isOwnedFailure = (value: unknown) =>
  (value as { owned?: boolean })?.owned === true
const isIdentityRejection = (
  value: unknown,
): value is LocalContainerImageIdentityRejection =>
  (value as { identity?: boolean })?.identity === true

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

  it('freezes the exact four raw migration hashes and unchanged body bytes', () => {
    const migrations = actualMigrations()
    expect(migrations.map(({ name }) => name)).toEqual(
      ROLLBACK_MIGRATION_BASENAMES,
    )
    expect(migrations.map(({ sha256: digest }) => digest)).toEqual(
      migrationHashes,
    )
    const sql = buildRollbackMigrationRehearsalSql(migrations)
    let previous = -1
    for (const [index, migration] of migrations.entries()) {
      const marker = serializeLocalRollbackRehearsalStageMarker(
        LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN[index + 1],
      ).trim()
      const markerPosition = sql.indexOf(marker)
      const bodyPosition = sql.indexOf(migration.body)
      expect(markerPosition).toBeGreaterThan(previous)
      expect(bodyPosition).toBeGreaterThan(markerPosition)
      expect(sql.indexOf(migration.body, bodyPosition + 1)).toBe(-1)
      expect(
        sql.slice(bodyPosition, bodyPosition + migration.body.length),
      ).toBe(migration.body)
      previous = bodyPosition
    }
    expect(sql).not.toMatch(/\balter\s+type\b/iu)
  })

  it('keeps one server transaction, the exact timeouts, and forward marker order', () => {
    const sql = buildRollbackMigrationRehearsalSql(actualMigrations())
    expect(sql.match(/^begin;\s*$/gimu)).toHaveLength(1)
    expect(sql.match(/^rollback;\s*$/gimu)).toHaveLength(1)
    expect(sql.match(/^commit;\s*$/gimu)).toBeNull()
    expect(sql).toContain("set statement_timeout = '300s';")
    expect(sql).toContain("set lock_timeout = '10s';")
    expect(sql.indexOf("set statement_timeout = '300s';")).toBeLessThan(
      sql.indexOf('begin;'),
    )
    expect(sql.indexOf("set lock_timeout = '10s';")).toBeLessThan(
      sql.indexOf('begin;'),
    )
    const expectedMarkers = LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN.slice(1)
    let previous = -1
    for (const marker of expectedMarkers) {
      const position = sql.indexOf(
        serializeLocalRollbackRehearsalStageMarker(marker).trim(),
      )
      expect(position).toBeGreaterThan(previous)
      previous = position
    }
    expect(previous).toBeLessThan(sql.indexOf('rollback;'))
  })

  it('keeps the baseline query server-identical behind one client marker', () => {
    const sql = buildRollbackHistoryBaselineSql()
    const marker = serializeLocalRollbackRehearsalStageMarker(
      LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN[0],
    )
    expect(sql).toBe(`\\warn ${marker}${ROLLBACK_HISTORY_BASELINE_SQL}`)
    expect(sql).toContain(ROLLBACK_HISTORY_BASELINE_SQL)
    expect(sql.match(/\bselect\b/giu)).toHaveLength(1)
    expect(sql).not.toMatch(
      /\b(?:alter|copy|create|delete|drop|grant|insert|revoke|truncate|update)\b/iu,
    )
  })

  it('makes exactly two ordered ownedPsql calls with exact marker plans', async () => {
    const migrations = fixtureMigrations()
    const psql = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify(expectedHistory()))
      .mockResolvedValueOnce('rollback_verified')
    const writes: string[] = []
    await expect(
      runRollbackDatabaseRehearsal({
        isIdentityRejection,
        isOwnedFailure,
        migrations,
        preContract: fixtureContract(),
        psql,
        write: (value: string) => {
          writes.push(value)
          return true
        },
      }),
    ).resolves.toBe('rollback_verified')
    expect(psql).toHaveBeenCalledTimes(2)
    expect(psql.mock.calls[0]).toEqual([
      'source',
      buildRollbackHistoryBaselineSql(),
      true,
      {
        clientStageMarkerPlan: buildLocalRollbackRehearsalClientStageMarkerPlan(
          {
            expectedStartIndex: 0,
          },
        ),
      },
    ])
    expect(psql.mock.calls[1]).toEqual([
      'source',
      buildRollbackMigrationRehearsalSql(migrations),
      true,
      {
        clientStageMarkerPlan: buildLocalRollbackRehearsalClientStageMarkerPlan(
          {
            expectedStartIndex: 1,
          },
        ),
      },
    ])
    expect(writes).toEqual([])
  })

  it('preserves the exact existing canonical success output', () => {
    const output = buildRollbackRehearsalSuccessOutput(
      'a'.repeat(40),
      actualMigrations(),
    )
    expect(output).toBe(
      `${JSON.stringify({
        commitSha: 'a'.repeat(40),
        migrationCount: 4,
        migrationSetSha256:
          'f52c276233744c3a5abc2d02570a528ea8ca399d8c1a0bcc014c176b20a83c96',
        status: 'rollback_verified',
      })}\n`,
    )
  })
})

describe('rollback migration rehearsal failure observation', () => {
  it('observes an exact history-baseline psql failure and stops after call one', async () => {
    const secret = [
      'postgresql',
      '://postgres:',
      'fake-password',
      '@127.0.0.1:59999/postgres',
    ].join('')
    const psql = vi.fn().mockRejectedValue(ownedFailure({ raw: secret }))
    const writes: string[] = []
    await expect(
      runRollbackDatabaseRehearsal({
        isIdentityRejection,
        isOwnedFailure,
        migrations: fixtureMigrations(),
        preContract: fixtureContract(),
        psql,
        write: (value: string) => {
          writes.push(value)
          return true
        },
      }),
    ).rejects.toThrow('failed closed')
    expect(psql).toHaveBeenCalledTimes(1)
    expect(writes).toHaveLength(1)
    expect(
      parseLocalRollbackMigrationRehearsalFailureDiagnostic(writes[0]),
    ).toMatchObject({
      stage: 'history_baseline',
      migrationBasename: null,
      completedMigrationCount: 0,
      psqlExitCode: 1,
      sqlstate: '42P01',
    })
    expect(writes.join('')).not.toContain(secret)
  })

  it('rejects a baseline failure index outside the one-marker call plan', async () => {
    const psql = vi
      .fn()
      .mockRejectedValue(ownedFailure({ lastClientStageMarkerIndex: 1 }))
    const writes: string[] = []
    await expect(
      runRollbackDatabaseRehearsal({
        isIdentityRejection,
        isOwnedFailure,
        migrations: fixtureMigrations(),
        preContract: fixtureContract(),
        psql,
        write: (value: string) => {
          writes.push(value)
          return true
        },
      }),
    ).rejects.toThrow('failed closed')
    expect(psql).toHaveBeenCalledTimes(1)
    expect(writes).toEqual([])
  })

  it.each([
    [0, 'migration_body', ROLLBACK_MIGRATION_BASENAMES[0], 0],
    [1, 'migration_body', ROLLBACK_MIGRATION_BASENAMES[1], 1],
    [2, 'migration_body', ROLLBACK_MIGRATION_BASENAMES[2], 2],
    [3, 'migration_body', ROLLBACK_MIGRATION_BASENAMES[3], 3],
    [4, 'probe', null, 4],
    [5, 'rollback_verification', null, 4],
  ] as const)(
    'maps rehearsal marker %i to %s/%i',
    async (lastClientStageMarkerIndex, stage, migrationBasename, count) => {
      const psql = vi
        .fn()
        .mockResolvedValueOnce(JSON.stringify(expectedHistory()))
        .mockRejectedValueOnce(ownedFailure({ lastClientStageMarkerIndex }))
      const writes: string[] = []
      await expect(
        runRollbackDatabaseRehearsal({
          isIdentityRejection,
          isOwnedFailure,
          migrations: fixtureMigrations(),
          preContract: fixtureContract(),
          psql,
          write: (value: string) => {
            writes.push(value)
            return true
          },
        }),
      ).rejects.toThrow('failed closed')
      expect(psql).toHaveBeenCalledTimes(2)
      expect(writes).toHaveLength(1)
      expect(
        parseLocalRollbackMigrationRehearsalFailureDiagnostic(writes[0]),
      ).toMatchObject({
        stage,
        migrationBasename,
        completedMigrationCount: count,
      })
    },
  )

  it.each([
    [
      'signal',
      {
        exitCode: null,
        signal: 'SIGTERM',
        sqlstate: null,
        timedOut: false,
      },
    ],
    [
      'timeout',
      { exitCode: null, signal: null, sqlstate: null, timedOut: true },
    ],
  ])(
    'allows a sanitized %s outcome after a valid marker',
    async (_label, outcome) => {
      const psql = vi
        .fn()
        .mockResolvedValueOnce(JSON.stringify(expectedHistory()))
        .mockRejectedValueOnce(ownedFailure(outcome))
      const writes: string[] = []
      await expect(
        runRollbackDatabaseRehearsal({
          isIdentityRejection,
          isOwnedFailure,
          migrations: fixtureMigrations(),
          preContract: fixtureContract(),
          psql,
          write: (value: string) => {
            writes.push(value)
            return true
          },
        }),
      ).rejects.toThrow('failed closed')
      expect(
        parseLocalRollbackMigrationRehearsalFailureDiagnostic(writes[0]),
      ).toMatchObject({
        psqlExitCode: outcome.exitCode,
        signal: outcome.signal,
        sqlstate: null,
        timedOut: outcome.timedOut,
      })
    },
  )

  it.each([
    ['missing marker', { lastClientStageMarkerIndex: null }],
    ['unknown marker', { lastClientStageMarkerIndex: 6 }],
    ['missing SQLSTATE', { sqlstate: null }],
    ['lowercase SQLSTATE', { sqlstate: '42p01' }],
    ['multiple SQLSTATEs', { sqlstate: '42P01 23505' }],
  ])(
    'fails closed without inventing evidence for %s',
    async (_label, override) => {
      const secret = [
        'Author',
        'ization: Bear',
        'er fake-invalid-failure-secret',
      ].join('')
      const psql = vi
        .fn()
        .mockResolvedValueOnce(JSON.stringify(expectedHistory()))
        .mockRejectedValueOnce(ownedFailure({ raw: secret, ...override }))
      const writes: string[] = []
      const error = await runRollbackDatabaseRehearsal({
        isIdentityRejection,
        isOwnedFailure,
        migrations: fixtureMigrations(),
        preContract: fixtureContract(),
        psql,
        write: (value: string) => {
          writes.push(value)
          return true
        },
      }).catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe(
        'Local rollback migration rehearsal failed closed',
      )
      expect((error as Error).message).not.toContain(secret)
      expect((error as Error).cause).toBeUndefined()
      expect(writes).toEqual([])
    },
  )

  it('gives identity rejection priority over every rollback diagnosis', async () => {
    const rejection = { identity: true, raw: 'token=fake-identity-secret' }
    const psql = vi.fn().mockRejectedValue(rejection)
    const writes: string[] = []
    await expect(
      runRollbackDatabaseRehearsal({
        isIdentityRejection,
        isOwnedFailure,
        migrations: fixtureMigrations(),
        preContract: fixtureContract(),
        psql,
        write: (value: string) => {
          writes.push(value)
          return true
        },
      }),
    ).rejects.toBe(rejection)
    expect(psql).toHaveBeenCalledTimes(1)
    expect(writes).toEqual([])
  })

  it.each([
    ['malformed baseline JSON', 'token=fake-baseline-json', 'history_baseline'],
    [
      'failed rollback verification',
      'token=fake-rollback-result',
      'rollback_verification',
    ],
  ])('sanitizes a logical %s', async (label, raw, expectedStage) => {
    const psql =
      label === 'malformed baseline JSON'
        ? vi.fn().mockResolvedValueOnce(raw)
        : vi
            .fn()
            .mockResolvedValueOnce(JSON.stringify(expectedHistory()))
            .mockResolvedValueOnce(raw)
    const writes: string[] = []
    await expect(
      runRollbackDatabaseRehearsal({
        isIdentityRejection,
        isOwnedFailure,
        migrations: fixtureMigrations(),
        preContract: fixtureContract(),
        psql,
        write: (value: string) => {
          writes.push(value)
          return true
        },
      }),
    ).rejects.toThrow('failed closed')
    expect(writes).toHaveLength(1)
    expect(
      parseLocalRollbackMigrationRehearsalFailureDiagnostic(writes[0]),
    ).toMatchObject({
      stage: expectedStage,
      psqlExitCode: null,
      signal: null,
      sqlstate: null,
      timedOut: false,
    })
    expect(writes[0]).not.toContain(raw)
  })

  it('uses a constant nonzero CLI failure without a stack or raw argument', () => {
    const secret = 'token=fake-cli-secret'
    const outcome = spawnSync(process.execPath, [runner, secret], {
      cwd: path.dirname(runner),
      encoding: 'utf8',
    })
    expect(outcome.status).toBe(1)
    expect(outcome.stdout).toBe('')
    expect(outcome.stderr).toBe(
      'Local rollback migration rehearsal failed closed.\n',
    )
    expect(outcome.stderr).not.toContain(secret)
    expect(outcome.stderr).not.toContain(runner)
  })

  it('uses only the shared reserved marker namespace', () => {
    const baselinePlan = buildLocalRollbackRehearsalClientStageMarkerPlan({
      expectedStartIndex: 0,
    })
    const rehearsalPlan = buildLocalRollbackRehearsalClientStageMarkerPlan({
      expectedStartIndex: 1,
    })
    expect(baselinePlan.prefix).toBe(
      'CAPITAL_LAB_CLIENT_STAGE_MARKER:ROLLBACK_REHEARSAL:',
    )
    expect(rehearsalPlan.prefix).toBe(baselinePlan.prefix)
    expect(
      [...baselinePlan.markers, ...rehearsalPlan.markers].every(
        (marker) =>
          marker.startsWith(LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PREFIX) &&
          /^[A-Za-z0-9_.:-]+$/u.test(marker),
      ),
    ).toBe(true)
  })
})
