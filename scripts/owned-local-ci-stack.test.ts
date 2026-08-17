import { describe, expect, it } from 'vitest'

import {
  LOCAL_CI_IMAGE,
  LOCAL_CI_IMAGE_ARCHITECTURE,
  LOCAL_CI_IMAGE_ID,
  LOCAL_CI_IMAGE_OS,
  LOCAL_CI_IMAGE_REPO_DIGEST,
  LOCAL_CI_RESET_CONFIRMATION,
  localCiImageIdentityEvidence,
  localCiConfig,
  localCiMarker,
  validateLocalCiContainerInspection,
  validateLocalCiMarker,
  validateOwnedLocalDatabaseImageInspection,
  validateLocalCiSqlTestName,
} from './lib/owned-local-ci-stack.mjs'
import { ownedDatabaseContainer } from './lib/local-container-postgres.mjs'
import { parseOwnedResetOptions } from './reset-owned-local-ci-stack.mjs'

const runId = 'run-12345-1'
const config = Buffer.from(localCiConfig(runId), 'utf8')
const inspection = {
  Config: { Image: LOCAL_CI_IMAGE },
  Id: 'a'.repeat(64),
  Image: LOCAL_CI_IMAGE_ID,
  Name: '/supabase_db_capital-lab-ci-run-12345-1',
  NetworkSettings: {
    Ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '54322' }] },
  },
  State: { Running: true },
}
const imageInspections = [
  {
    Architecture: LOCAL_CI_IMAGE_ARCHITECTURE,
    Id: LOCAL_CI_IMAGE_ID,
    Os: LOCAL_CI_IMAGE_OS,
    RepoDigests: [LOCAL_CI_IMAGE_REPO_DIGEST],
  },
]

describe('run-owned local CI Supabase stack', () => {
  it('disables CLI migrations and seeds on the exact loopback ports', () => {
    expect(config.toString('utf8')).toContain(
      '[db.migrations]\nenabled = false',
    )
    expect(config.toString('utf8')).toContain('[db.seed]\nenabled = false')
    expect(config.toString('utf8')).toContain('port = 54322')
  })

  it('copies both numbered and named pgTAP files but rejects unsafe entries', () => {
    expect(validateLocalCiSqlTestName('0001_database_contract.sql')).toBe(
      '0001_database_contract.sql',
    )
    expect(
      validateLocalCiSqlTestName('activation_readiness_follow_up_test.sql'),
    ).toBe('activation_readiness_follow_up_test.sql')
    expect(() => validateLocalCiSqlTestName('../outside.sql')).toThrow(
      /unexpected entry/u,
    )
    expect(() => validateLocalCiSqlTestName('README.md')).toThrow(
      /unexpected entry/u,
    )
  })

  it('binds the marker to exact config bytes and the disposable run', () => {
    const marker = localCiMarker(runId, config)
    expect(validateLocalCiMarker(marker, runId, config)).toEqual(marker)
    expect(() =>
      validateLocalCiMarker(marker, runId, Buffer.from(`${config} `)),
    ).toThrow(/marker is invalid/u)
  })

  it('accepts only the exact owned container, image and port binding', () => {
    const identity = validateLocalCiContainerInspection(
      inspection,
      imageInspections,
      runId,
    )
    expect(identity).toMatchObject({
      runtimeImageReference: LOCAL_CI_IMAGE,
      imageId: LOCAL_CI_IMAGE_ID,
      imageRepoDigest: LOCAL_CI_IMAGE_REPO_DIGEST,
      imageOs: 'linux',
      imageArchitecture: 'amd64',
      projectId: 'capital-lab-ci-run-12345-1',
    })
    expect(localCiImageIdentityEvidence(identity)).toEqual({
      runtimeImageReference: LOCAL_CI_IMAGE,
      imageRepoDigest: LOCAL_CI_IMAGE_REPO_DIGEST,
      imageId: LOCAL_CI_IMAGE_ID,
      imageOs: LOCAL_CI_IMAGE_OS,
      imageArchitecture: LOCAL_CI_IMAGE_ARCHITECTURE,
    })
    expect(() =>
      validateLocalCiContainerInspection(
        { ...inspection, Config: { Image: 'docker.io/postgres:latest' } },
        imageInspections,
        runId,
      ),
    ).toThrow(/binding is invalid/u)
    expect(() =>
      validateLocalCiContainerInspection(
        {
          ...inspection,
          Config: {
            Image: 'public.ecr.aws/supabase/postgres:17.6.1.158',
          },
        },
        imageInspections,
        runId,
      ),
    ).toThrow(/binding is invalid/u)
    expect(() =>
      validateLocalCiContainerInspection(
        {
          ...inspection,
          NetworkSettings: {
            Ports: {
              '5432/tcp': [{ HostIp: '0.0.0.0', HostPort: '54322' }],
            },
          },
        },
        imageInspections,
        runId,
      ),
    ).toThrow(/binding is invalid/u)
  })

  it.each([
    [
      'missing container image ID',
      { ...inspection, Image: undefined },
      imageInspections,
    ],
    [
      'wrong container image ID',
      { ...inspection, Image: `sha256:${'f'.repeat(64)}` },
      imageInspections,
    ],
    ['empty image inspect', inspection, []],
    [
      'multiple image inspect results',
      inspection,
      [...imageInspections, imageInspections[0]],
    ],
    [
      'missing image inspect ID',
      inspection,
      [{ ...imageInspections[0], Id: undefined }],
    ],
    [
      'wrong image inspect ID',
      inspection,
      [{ ...imageInspections[0], Id: `sha256:${'f'.repeat(64)}` }],
    ],
    [
      'missing RepoDigest',
      inspection,
      [{ ...imageInspections[0], RepoDigests: [] }],
    ],
    [
      'wrong RepoDigest',
      inspection,
      [
        {
          ...imageInspections[0],
          RepoDigests: ['ghcr.io/supabase/postgres@sha256:' + 'f'.repeat(64)],
        },
      ],
    ],
    [
      'additional RepoDigest',
      inspection,
      [
        {
          ...imageInspections[0],
          RepoDigests: [
            LOCAL_CI_IMAGE_REPO_DIGEST,
            'public.ecr.aws/supabase/postgres@sha256:' + '9'.repeat(64),
          ],
        },
      ],
    ],
    ['wrong OS', inspection, [{ ...imageInspections[0], Os: 'windows' }]],
    [
      'wrong architecture',
      inspection,
      [{ ...imageInspections[0], Architecture: 'arm64' }],
    ],
  ])('rejects %s', (_label, container, images) => {
    expect(() =>
      validateLocalCiContainerInspection(container, images, runId),
    ).toThrow()
  })

  it('cannot derive the immutable identity from environment or caller spoofing', () => {
    const previous = process.env.SUPABASE_INTERNAL_IMAGE_REGISTRY
    process.env.SUPABASE_INTERNAL_IMAGE_REGISTRY = 'public.ecr.aws'
    try {
      expect(
        validateLocalCiContainerInspection(inspection, imageInspections, runId)
          .runtimeImageReference,
      ).toBe(LOCAL_CI_IMAGE)
      expect(() =>
        (
          validateOwnedLocalDatabaseImageInspection as unknown as (
            ...args: unknown[]
          ) => unknown
        )(
          inspection,
          [{ ...imageInspections[0], Id: `sha256:${'f'.repeat(64)}` }],
          { imageId: `sha256:${'f'.repeat(64)}` },
        ),
      ).toThrow(/immutable image identity/u)
    } finally {
      if (previous === undefined)
        delete process.env.SUPABASE_INTERNAL_IMAGE_REGISTRY
      else process.env.SUPABASE_INTERNAL_IMAGE_REGISTRY = previous
    }
  })

  it('requires the exact destructive confirmation, run and workdir', () => {
    expect(
      parseOwnedResetOptions([
        `--confirm=${LOCAL_CI_RESET_CONFIRMATION}`,
        `--run-id=${runId}`,
        '--workdir=C:/ephemeral/owned-stack',
      ]),
    ).toMatchObject({ 'run-id': runId })
    expect(() =>
      parseOwnedResetOptions([
        '--confirm=reset it',
        `--run-id=${runId}`,
        '--workdir=C:/ephemeral/owned-stack',
      ]),
    ).toThrow(/authority is required/u)
  })

  it('derives only run-owned source, restore and Reference containers', () => {
    expect(
      ownedDatabaseContainer('source', {
        ...process.env,
        CAPITAL_LAB_CI_RUN_ID: runId,
      }).container,
    ).toBe('supabase_db_capital-lab-ci-run-12345-1')
    expect(
      ownedDatabaseContainer('restore', {
        ...process.env,
        CAPITAL_LAB_RESTORE_RUN_ID: runId,
      }).container,
    ).toBe('supabase_db_capital-lab-restore-run-12345-1')
    expect(
      ownedDatabaseContainer('reference', {
        ...process.env,
        CAPITAL_LAB_REFERENCE_DATABASE_PORT: '56001',
        CAPITAL_LAB_REFERENCE_RUN_ID: 'run-pre-a-12345-1',
      }).container,
    ).toBe('supabase_db_capital-lab-reference-run-pre-a-12345-1')
    expect(() =>
      ownedDatabaseContainer('reference', {
        ...process.env,
        CAPITAL_LAB_REFERENCE_DATABASE_PORT: '5432',
        CAPITAL_LAB_REFERENCE_RUN_ID: 'run-pre-a-12345-1;rm',
      }),
    ).toThrow(/identity is invalid/u)
  })
})
