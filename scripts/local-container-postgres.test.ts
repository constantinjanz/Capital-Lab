import { EventEmitter } from 'node:events'

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  LOCAL_CI_IMAGE,
  LOCAL_CI_IMAGE_ARCHITECTURE,
  LOCAL_CI_IMAGE_ID,
  LOCAL_CI_IMAGE_OS,
  LOCAL_CI_IMAGE_REPO_DIGEST,
  canonicalReferenceProjectId,
} from './lib/owned-local-ci-stack.mjs'

const processMocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(),
}))
const originalSourceRunId = process.env.CAPITAL_LAB_CI_RUN_ID
const originalCommitSha = process.env.CAPITAL_LAB_CI_COMMIT_SHA

vi.mock('node:child_process', () => processMocks)
vi.mock('./lib/safe-process.mjs', () => ({
  resolveNativeExecutable: () => ({ command: 'docker' }),
  resolvedArguments: (_executable: unknown, args: string[]) => args,
}))

import {
  inspectOwnedDatabaseContainer,
  isOwnedLocalPostgresToolFailure,
  runOwnedPostgresTool,
} from './lib/local-container-postgres.mjs'
import { LocalContainerImageIdentityRejection } from './lib/local-container-identity-diagnostic.mjs'

const imageInspection = {
  Architecture: LOCAL_CI_IMAGE_ARCHITECTURE,
  Id: LOCAL_CI_IMAGE_ID,
  Os: LOCAL_CI_IMAGE_OS,
  RepoDigests: [LOCAL_CI_IMAGE_REPO_DIGEST],
}

function containerInspection(container: string, port: string) {
  return {
    Config: { Image: LOCAL_CI_IMAGE },
    Id: 'a'.repeat(64),
    Image: LOCAL_CI_IMAGE_ID,
    Name: `/${container}`,
    NetworkSettings: {
      Ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: port }] },
    },
    State: { Running: true },
  }
}

function successfulInspect(value: unknown) {
  return {
    error: undefined,
    signal: null,
    status: 0,
    stdout: JSON.stringify([value]),
  }
}

type MockChild = EventEmitter & {
  kill: ReturnType<typeof vi.fn>
  stderr: EventEmitter
  stdin: { end: ReturnType<typeof vi.fn> }
  stdout: EventEmitter
}

type SanitizedPsqlFailure = Error & {
  exitCode: number | null
  lastClientStageMarkerIndex: number | null
  signal: string | null
  sqlstate: string | null
  timedOut: boolean
}

const rollbackMarkerPrefix =
  'CAPITAL_LAB_CLIENT_STAGE_MARKER:ROLLBACK_REHEARSAL:'
const rollbackMarkerPlan = Object.freeze({
  markers: Object.freeze([
    `${rollbackMarkerPrefix}0:history_baseline:0:-`,
    `${rollbackMarkerPrefix}1:migration_body:0:20260809150000_post_build_hosting_safety.sql`,
    `${rollbackMarkerPrefix}2:migration_body:1:20260809150417_activation_readiness_follow_up.sql`,
    `${rollbackMarkerPrefix}3:probe:4:-`,
    `${rollbackMarkerPrefix}4:rollback_verification:4:-`,
  ]),
  prefix: rollbackMarkerPrefix,
})
const migrationReplayMarkerPrefix =
  'CAPITAL_LAB_CLIENT_STAGE_MARKER:MIGRATION_REPLAY:'
const migrationReplayMarkerPlan = Object.freeze({
  markers: Object.freeze([
    `${migrationReplayMarkerPrefix}0|migration_apply|8|20260806165114_private_storage.sql`,
  ]),
  prefix: migrationReplayMarkerPrefix,
})

function prepareValidSourceInspection() {
  const container = containerInspection(
    'supabase_db_capital-lab-ci-run-12345-1',
    '54322',
  )
  processMocks.spawnSync
    .mockReturnValueOnce(successfulInspect(container))
    .mockReturnValueOnce(successfulInspect(imageInspection))
}

function spawnedChild({
  code = 0,
  emitError,
  endError,
  signal = null,
  stderr = '',
  stdout = '',
}: {
  code?: number | null
  emitError?: Error
  endError?: Error
  signal?: string | null
  stderr?: string
  stdout?: string
} = {}): MockChild {
  const child = new EventEmitter() as MockChild
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn(() => true)
  child.stdin = {
    end: vi.fn(() => {
      if (endError) throw endError
      queueMicrotask(() => {
        if (stdout) child.stdout.emit('data', Buffer.from(stdout))
        if (stderr) child.stderr.emit('data', Buffer.from(stderr))
        if (emitError) child.emit('error', emitError)
        else child.emit('close', code, signal)
      })
    }),
  }
  return child
}

function hangingChild(): MockChild {
  const child = new EventEmitter() as MockChild
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.stdin = { end: vi.fn() }
  child.kill = vi.fn((signal: string) => {
    if (signal === 'SIGTERM') {
      queueMicrotask(() => child.emit('close', null, 'SIGTERM'))
    }
    return true
  })
  return child
}

async function rejectedPsqlFailure(promise: Promise<unknown>) {
  const error = await promise.catch((caught: unknown) => caught)
  expect(isOwnedLocalPostgresToolFailure(error)).toBe(true)
  return error as SanitizedPsqlFailure
}

async function runRejectedPsql(
  stderr: string,
  {
    clientStageMarkerPlan,
    code = 1,
    signal = null,
  }: {
    clientStageMarkerPlan?: {
      readonly markers: readonly string[]
      readonly prefix: string
    }
    code?: number | null
    signal?: string | null
  } = {},
) {
  prepareValidSourceInspection()
  processMocks.spawn.mockReturnValueOnce(spawnedChild({ code, signal, stderr }))
  return rejectedPsqlFailure(
    runOwnedPostgresTool('source', 'psql', ['--no-psqlrc'], 'select 1;', {
      clientStageMarkerPlan,
    }),
  )
}

async function rejectedIdentity(promise: Promise<unknown>) {
  const error = await promise.catch((caught: unknown) => caught)
  expect(error).toBeInstanceOf(LocalContainerImageIdentityRejection)
  return error as LocalContainerImageIdentityRejection
}

function thrownIdentity(run: () => unknown) {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(LocalContainerImageIdentityRejection)
    return error as LocalContainerImageIdentityRejection
  }
  throw new Error('Expected local container identity rejection')
}

describe('owned local PostgreSQL subprocess image boundary', () => {
  beforeEach(() => {
    process.env.CAPITAL_LAB_CI_RUN_ID = 'run-12345-1'
    delete process.env.CAPITAL_LAB_CI_COMMIT_SHA
    processMocks.spawn.mockReset()
    processMocks.spawnSync.mockReset()
  })

  afterAll(() => {
    if (originalSourceRunId === undefined)
      delete process.env.CAPITAL_LAB_CI_RUN_ID
    else process.env.CAPITAL_LAB_CI_RUN_ID = originalSourceRunId
    if (originalCommitSha === undefined)
      delete process.env.CAPITAL_LAB_CI_COMMIT_SHA
    else process.env.CAPITAL_LAB_CI_COMMIT_SHA = originalCommitSha
  })

  it('resolves image inspection only through the container immutable Image ID', () => {
    const container = containerInspection(
      'supabase_db_capital-lab-ci-run-12345-1',
      '54322',
    )
    processMocks.spawnSync
      .mockReturnValueOnce(successfulInspect(container))
      .mockReturnValueOnce(successfulInspect(imageInspection))

    expect(
      inspectOwnedDatabaseContainer('source', {
        ...process.env,
        CAPITAL_LAB_CI_RUN_ID: 'run-12345-1',
      }).identity,
    ).toMatchObject({ imageId: LOCAL_CI_IMAGE_ID })
    expect(processMocks.spawnSync).toHaveBeenNthCalledWith(
      2,
      'docker',
      ['image', 'inspect', LOCAL_CI_IMAGE_ID],
      expect.objectContaining({ shell: false }),
    )
  })

  it('starts no psql process when the container reference is invalid', async () => {
    const container = {
      ...containerInspection('supabase_db_capital-lab-ci-run-12345-1', '54322'),
      Config: { Image: 'public.ecr.aws/supabase/postgres:17.6.1.158' },
    }
    processMocks.spawnSync.mockReturnValueOnce(successfulInspect(container))

    const error = await rejectedIdentity(
      runOwnedPostgresTool('source', 'psql', ['--version'], undefined),
    )
    expect(error.identityDiagnostic).toMatchObject({
      failure_stage: 'container_binding',
      mismatch_fields: ['config_image'],
    })
    expect(processMocks.spawnSync).toHaveBeenCalledTimes(1)
    expect(processMocks.spawn).not.toHaveBeenCalled()
  })

  it('starts no psql process when immutable image evidence is invalid', async () => {
    const container = containerInspection(
      'supabase_db_capital-lab-ci-run-12345-1',
      '54322',
    )
    processMocks.spawnSync
      .mockReturnValueOnce(successfulInspect(container))
      .mockReturnValueOnce(
        successfulInspect({
          ...imageInspection,
          RepoDigests: [],
        }),
      )

    const error = await rejectedIdentity(
      runOwnedPostgresTool('source', 'psql', ['--version'], undefined),
    )
    expect(error.identityDiagnostic).toMatchObject({
      failure_stage: 'immutable_identity',
      mismatch_fields: ['expected_repo_digest_missing', 'repo_digest_count'],
    })
    expect(processMocks.spawnSync).toHaveBeenCalledTimes(2)
    expect(processMocks.spawn).not.toHaveBeenCalled()
  })

  it.each([
    [
      'container_inspect',
      [
        {
          error: undefined,
          signal: null,
          status: 1,
          stdout: 'synthetic secret must stay private',
        },
      ],
    ],
    [
      'container_shape',
      [
        {
          error: undefined,
          signal: null,
          status: 0,
          stdout: 'not-json synthetic secret',
        },
      ],
    ],
    [
      'container_binding',
      [
        successfulInspect({
          ...containerInspection(
            'supabase_db_capital-lab-ci-run-12345-1',
            '54322',
          ),
          Config: { Image: 'public.ecr.aws/supabase/postgres:17.6.1.158' },
        }),
      ],
    ],
    [
      'image_inspect',
      [
        successfulInspect(
          containerInspection(
            'supabase_db_capital-lab-ci-run-12345-1',
            '54322',
          ),
        ),
        {
          error: undefined,
          signal: null,
          status: 1,
          stdout: 'synthetic secret must stay private',
        },
      ],
    ],
    [
      'image_shape',
      [
        successfulInspect(
          containerInspection(
            'supabase_db_capital-lab-ci-run-12345-1',
            '54322',
          ),
        ),
        { error: undefined, signal: null, status: 0, stdout: '[]' },
      ],
    ],
    [
      'immutable_identity',
      [
        successfulInspect(
          containerInspection(
            'supabase_db_capital-lab-ci-run-12345-1',
            '54322',
          ),
        ),
        successfulInspect({ ...imageInspection, RepoDigests: [] }),
      ],
    ],
  ] as const)(
    'starts no psql process after %s rejection',
    async (stage, results) => {
      for (const result of results) {
        processMocks.spawnSync.mockReturnValueOnce(result)
      }
      const error = await rejectedIdentity(
        runOwnedPostgresTool('source', 'psql', ['--version'], undefined),
      )
      const expectedMismatches = {
        container_inspect: ['container_inspect_unavailable'],
        container_shape: ['container_json'],
        container_binding: ['config_image'],
        image_inspect: ['image_inspect_unavailable'],
        image_shape: ['image_result_count'],
        immutable_identity: [
          'expected_repo_digest_missing',
          'repo_digest_count',
        ],
      } as const
      expect(error.identityDiagnostic).toMatchObject({
        failure_stage: stage,
        mismatch_fields: expectedMismatches[stage],
      })
      expect(processMocks.spawn).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['empty', []],
    [
      'multiple',
      [
        containerInspection('supabase_db_capital-lab-ci-run-12345-1', '54322'),
        containerInspection('supabase_db_capital-lab-ci-run-12345-1', '54322'),
      ],
    ],
  ])(
    'starts no psql process for %s container inspect results',
    async (_label, containers) => {
      processMocks.spawnSync.mockReturnValueOnce({
        error: undefined,
        signal: null,
        status: 0,
        stdout: JSON.stringify(containers),
      })

      const error = await rejectedIdentity(
        runOwnedPostgresTool('source', 'psql', ['--version'], undefined),
      )
      expect(error.identityDiagnostic).toMatchObject({
        failure_stage: 'container_shape',
        mismatch_fields: ['container_result_count'],
      })
      expect(processMocks.spawnSync).toHaveBeenCalledTimes(1)
      expect(processMocks.spawn).not.toHaveBeenCalled()
    },
  )

  it.each([
    [
      'restore',
      {
        CAPITAL_LAB_RESTORE_RUN_ID: 'run-12345',
      },
      'supabase_db_capital-lab-restore-run-12345',
      '55322',
    ],
    [
      'reference',
      {
        CAPITAL_LAB_REFERENCE_DATABASE_PORT: '56001',
        CAPITAL_LAB_REFERENCE_RUN_ID: 'run-pre-a-12345-1',
      },
      `supabase_db_${canonicalReferenceProjectId('run-pre-a-12345-1')}`,
      '56001',
    ],
    [
      'peer_reference',
      {
        CAPITAL_LAB_PEER_REFERENCE_DATABASE_PORT: '56005',
        CAPITAL_LAB_PEER_REFERENCE_RUN_ID: 'run-pre-b-12345-1',
      },
      `supabase_db_${canonicalReferenceProjectId('run-pre-b-12345-1')}`,
      '56005',
    ],
  ] as const)(
    'rejects a wrong %s identity even after Source validated',
    (role, env, containerName, port) => {
      const source = containerInspection(
        'supabase_db_capital-lab-ci-run-12345-1',
        '54322',
      )
      const wrongTarget = {
        ...containerInspection(containerName, port),
        Image: `sha256:${'f'.repeat(64)}`,
      }
      processMocks.spawnSync
        .mockReturnValueOnce(successfulInspect(source))
        .mockReturnValueOnce(successfulInspect(imageInspection))
        .mockReturnValueOnce(successfulInspect(wrongTarget))
        .mockReturnValueOnce(successfulInspect(imageInspection))

      expect(
        inspectOwnedDatabaseContainer('source', {
          ...process.env,
          CAPITAL_LAB_CI_RUN_ID: 'run-12345-1',
        }).identity,
      ).toMatchObject({ imageId: LOCAL_CI_IMAGE_ID })
      const error = thrownIdentity(() =>
        inspectOwnedDatabaseContainer(role, { ...process.env, ...env }),
      )
      expect(error.identityDiagnostic).toMatchObject({
        failure_stage: 'immutable_identity',
        mismatch_fields: ['container_image_id'],
      })
      expect(processMocks.spawn).not.toHaveBeenCalled()
    },
  )

  describe('sanitized psql failure boundary', () => {
    it('sets SQLSTATE-only verbosity centrally and removes marker lines on success', async () => {
      prepareValidSourceInspection()
      processMocks.spawn.mockReturnValueOnce(
        spawnedChild({
          stderr: [
            rollbackMarkerPlan.markers[0],
            'NOTICE: safe non-marker output',
            `${rollbackMarkerPrefix}99:unknown:9:-`,
            '',
          ].join('\n'),
          stdout: 'rollback_verified\n',
        }),
      )

      const result = await runOwnedPostgresTool(
        'source',
        'psql',
        ['--no-psqlrc', '--set=ON_ERROR_STOP=1'],
        'select 1;',
        { clientStageMarkerPlan: rollbackMarkerPlan },
      )

      expect(result).toEqual({
        stderr: 'NOTICE: safe non-marker output\n',
        stdout: 'rollback_verified\n',
      })
      const dockerArguments = processMocks.spawn.mock.calls[0]?.[1] as string[]
      expect(
        dockerArguments.filter(
          (argument) => argument === '--set=VERBOSITY=sqlstate',
        ),
      ).toHaveLength(1)
      expect(dockerArguments).toEqual([
        'exec',
        '--interactive',
        'supabase_db_capital-lab-ci-run-12345-1',
        'psql',
        '--username=postgres',
        '--dbname=postgres',
        '--no-psqlrc',
        '--set=ON_ERROR_STOP=1',
        '--set=VERBOSITY=sqlstate',
      ])
    })

    it.each([
      ['exactly one', 'ERROR:  42P01\n', '42P01'],
      ['none', 'psql client failure without a server code\n', null],
      ['multiple', 'ERROR:  42P01\nERROR:  23505\n', null],
      ['lowercase', 'ERROR:  42p01\n', null],
      ['short', 'ERROR:  42P0\n', null],
      ['long', 'ERROR:  42P010\n', null],
      ['suffix text', 'ERROR:  42P01 relation-name\n', null],
      ['one valid plus one malformed', 'ERROR:  42P01\nERROR:  42p01\n', null],
    ] as const)(
      'derives %s SQLSTATE safely',
      async (_label, stderr, expected) => {
        const error = await runRejectedPsql(stderr)
        expect(error).toMatchObject({
          exitCode: 1,
          signal: null,
          sqlstate: expected,
          timedOut: false,
        })
      },
    )

    it('accepts the exact pipe-delimited Migration-Replay marker plan', async () => {
      const error = await runRejectedPsql(
        `${migrationReplayMarkerPlan.markers[0]}\nERROR:  42P01\n`,
        { clientStageMarkerPlan: migrationReplayMarkerPlan },
      )
      expect(error.lastClientStageMarkerIndex).toBe(0)
    })

    it('retains only fixed typed fields and discards raw failure material', async () => {
      const fakeSecret =
        'postgresql://postgres:' + 'fake-password' + '@127.0.0.1:59999/postgres'
      const error = await runRejectedPsql(
        `ERROR:  42P01\n${fakeSecret}\nselect fake_raw_sql;\n`,
      )

      expect(error.message).toBe('Owned local PostgreSQL tool failed closed')
      expect(error).toMatchObject({
        exitCode: 1,
        lastClientStageMarkerIndex: null,
        signal: null,
        sqlstate: '42P01',
        timedOut: false,
      })
      expect(Object.getOwnPropertyNames(error).sort()).toEqual(
        [
          'exitCode',
          'lastClientStageMarkerIndex',
          'message',
          'signal',
          'sqlstate',
          'timedOut',
        ].sort(),
      )
      expect(Object.getOwnPropertySymbols(error)).toEqual([])
      expect(Object.isFrozen(error)).toBe(true)
      for (const serialized of [
        String(error),
        JSON.stringify(error),
        JSON.stringify(Object.getOwnPropertyDescriptors(error)),
      ]) {
        expect(serialized).not.toContain(fakeSecret)
        expect(serialized).not.toContain('fake_raw_sql')
        expect(serialized).not.toContain('127.0.0.1')
        expect(serialized).not.toContain('59999')
        expect(serialized).not.toContain('stderr')
        expect(serialized).not.toContain('stdout')
        expect(serialized).not.toContain('cause')
        expect(serialized).not.toContain('command')
        expect(serialized).not.toContain('args')
      }
    })

    it.each([
      ['valid prefix', rollbackMarkerPlan.markers.slice(0, 3), 2],
      [
        'duplicate',
        [
          rollbackMarkerPlan.markers[0],
          rollbackMarkerPlan.markers[1],
          rollbackMarkerPlan.markers[1],
        ],
        null,
      ],
      [
        'unknown',
        [
          rollbackMarkerPlan.markers[0],
          `${rollbackMarkerPrefix}99:unknown:1:-`,
        ],
        null,
      ],
      [
        'backward',
        [
          rollbackMarkerPlan.markers[0],
          rollbackMarkerPlan.markers[1],
          rollbackMarkerPlan.markers[0],
        ],
        null,
      ],
      [
        'skipped',
        [rollbackMarkerPlan.markers[0], rollbackMarkerPlan.markers[2]],
        null,
      ],
      ['missing first', [rollbackMarkerPlan.markers[1]], null],
    ] as const)(
      'accepts only a forward, unique marker prefix: %s',
      async (_label, markers, expected) => {
        const error = await runRejectedPsql(
          `${markers.join('\n')}\nERROR:  42P01\n`,
          { clientStageMarkerPlan: rollbackMarkerPlan },
        )
        expect(error.lastClientStageMarkerIndex).toBe(expected)
      },
    )

    it('returns no SQLSTATE or marker after bounded stderr truncation', async () => {
      const error = await runRejectedPsql(
        `${'x'.repeat(70 * 1024)}\n${rollbackMarkerPlan.markers[0]}\nERROR:  42P01\n`,
        { clientStageMarkerPlan: rollbackMarkerPlan },
      )
      expect(error).toMatchObject({
        lastClientStageMarkerIndex: null,
        sqlstate: null,
      })
    })

    it('rejects an invalid caller marker plan without starting psql', async () => {
      prepareValidSourceInspection()
      const error = await rejectedPsqlFailure(
        runOwnedPostgresTool('source', 'psql', [], 'select 1;', {
          clientStageMarkerPlan: {
            markers: ['NOT_RESERVED:history_preflight'],
            prefix: 'NOT_RESERVED:',
          },
        }),
      )
      expect(error).toMatchObject({
        exitCode: null,
        lastClientStageMarkerIndex: null,
        signal: null,
        sqlstate: null,
        timedOut: false,
      })
      expect(processMocks.spawn).not.toHaveBeenCalled()
    })

    it('sanitizes valid and invalid child signals', async () => {
      const signaled = await runRejectedPsql('ERROR:  42P01\n', {
        code: null,
        signal: 'SIGTERM',
      })
      expect(signaled).toMatchObject({
        exitCode: null,
        signal: 'SIGTERM',
        sqlstate: null,
        timedOut: false,
      })

      const invalidSignal = await runRejectedPsql('ERROR:  42P01\n', {
        code: 1,
        signal: 'SIG_FAKE_SECRET',
      })
      expect(invalidSignal).toMatchObject({
        exitCode: null,
        signal: null,
        sqlstate: null,
        timedOut: false,
      })
      expect(JSON.stringify(invalidSignal)).not.toContain('FAKE_SECRET')
    })

    it('reports timeout without claiming a buffered SQLSTATE', async () => {
      vi.useFakeTimers()
      try {
        prepareValidSourceInspection()
        const child = hangingChild()
        processMocks.spawn.mockReturnValueOnce(child)
        const promise = rejectedPsqlFailure(
          runOwnedPostgresTool('source', 'psql', ['--no-psqlrc'], 'select 1;', {
            timeoutMs: 25,
          }),
        )
        await vi.advanceTimersByTimeAsync(25)
        const error = await promise
        expect(error).toMatchObject({
          exitCode: null,
          signal: 'SIGTERM',
          sqlstate: null,
          timedOut: true,
        })
        expect(child.kill).toHaveBeenCalledWith('SIGTERM')
      } finally {
        vi.useRealTimers()
      }
    })

    it.each(['event', 'stdin', 'throw'] as const)(
      'sanitizes a spawn %s without retaining its error',
      async (mode) => {
        const fakeSecret = 'FAKE_SPAWN_SECRET=/private/local/path'
        prepareValidSourceInspection()
        if (mode === 'event') {
          processMocks.spawn.mockReturnValueOnce(
            spawnedChild({ emitError: new Error(fakeSecret) }),
          )
        } else if (mode === 'stdin') {
          processMocks.spawn.mockReturnValueOnce(
            spawnedChild({ endError: new Error(fakeSecret) }),
          )
        } else {
          processMocks.spawn.mockImplementationOnce(() => {
            throw new Error(fakeSecret)
          })
        }
        const error = await rejectedPsqlFailure(
          runOwnedPostgresTool('source', 'psql', [], 'select 1;'),
        )
        expect(error).toMatchObject({
          exitCode: null,
          lastClientStageMarkerIndex: null,
          signal: null,
          sqlstate: null,
          timedOut: false,
        })
        expect(String(error)).not.toContain(fakeSecret)
        expect(JSON.stringify(error)).not.toContain(fakeSecret)
      },
    )
  })
})
