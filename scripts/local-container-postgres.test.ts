import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  LOCAL_CI_IMAGE,
  LOCAL_CI_IMAGE_ARCHITECTURE,
  LOCAL_CI_IMAGE_ID,
  LOCAL_CI_IMAGE_OS,
  LOCAL_CI_IMAGE_REPO_DIGEST,
} from './lib/owned-local-ci-stack.mjs'

const processMocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(),
}))
const originalSourceRunId = process.env.CAPITAL_LAB_CI_RUN_ID

vi.mock('node:child_process', () => processMocks)
vi.mock('./lib/safe-process.mjs', () => ({
  resolveNativeExecutable: () => ({ command: 'docker' }),
  resolvedArguments: (_executable: unknown, args: string[]) => args,
}))

import {
  inspectOwnedDatabaseContainer,
  runOwnedPostgresTool,
} from './lib/local-container-postgres.mjs'

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

describe('owned local PostgreSQL subprocess image boundary', () => {
  beforeEach(() => {
    process.env.CAPITAL_LAB_CI_RUN_ID = 'run-12345-1'
    processMocks.spawn.mockReset()
    processMocks.spawnSync.mockReset()
  })

  afterAll(() => {
    if (originalSourceRunId === undefined)
      delete process.env.CAPITAL_LAB_CI_RUN_ID
    else process.env.CAPITAL_LAB_CI_RUN_ID = originalSourceRunId
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

    await expect(
      runOwnedPostgresTool('source', 'psql', ['--version'], undefined),
    ).rejects.toThrow(/container binding/u)
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

    await expect(
      runOwnedPostgresTool('source', 'psql', ['--version'], undefined),
    ).rejects.toThrow(/immutable image identity/u)
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
    async (_stage, results) => {
      for (const result of results) {
        processMocks.spawnSync.mockReturnValueOnce(result)
      }
      await expect(
        runOwnedPostgresTool('source', 'psql', ['--version'], undefined),
      ).rejects.toThrow()
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

      await expect(
        runOwnedPostgresTool('source', 'psql', ['--version'], undefined),
      ).rejects.toThrow(/container is not unique/u)
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
      'supabase_db_capital-lab-reference-run-pre-a-12345-1',
      '56001',
    ],
    [
      'peer_reference',
      {
        CAPITAL_LAB_PEER_REFERENCE_DATABASE_PORT: '56005',
        CAPITAL_LAB_PEER_REFERENCE_RUN_ID: 'run-pre-b-12345-1',
      },
      'supabase_db_capital-lab-reference-run-pre-b-12345-1',
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
      expect(() =>
        inspectOwnedDatabaseContainer(role, { ...process.env, ...env }),
      ).toThrow(/immutable image identity/u)
      expect(processMocks.spawn).not.toHaveBeenCalled()
    },
  )
})
