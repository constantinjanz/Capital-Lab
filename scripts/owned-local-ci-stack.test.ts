import { describe, expect, it } from 'vitest'

import {
  LOCAL_CI_IMAGE,
  LOCAL_CI_RESET_CONFIRMATION,
  localCiConfig,
  localCiMarker,
  validateLocalCiContainerInspection,
  validateLocalCiMarker,
} from './lib/owned-local-ci-stack.mjs'
import { ownedDatabaseContainer } from './lib/local-container-postgres.mjs'
import { parseOwnedResetOptions } from './reset-owned-local-ci-stack.mjs'

const runId = 'run-12345-1'
const config = Buffer.from(localCiConfig(runId), 'utf8')
const inspection = {
  Config: { Image: LOCAL_CI_IMAGE },
  Id: 'a'.repeat(64),
  Name: '/supabase_db_capital-lab-ci-run-12345-1',
  NetworkSettings: {
    Ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '54322' }] },
  },
  State: { Running: true },
}

describe('run-owned local CI Supabase stack', () => {
  it('disables CLI migrations and seeds on the exact loopback ports', () => {
    expect(config.toString('utf8')).toContain(
      '[db.migrations]\nenabled = false',
    )
    expect(config.toString('utf8')).toContain('[db.seed]\nenabled = false')
    expect(config.toString('utf8')).toContain('port = 54322')
  })

  it('binds the marker to exact config bytes and the disposable run', () => {
    const marker = localCiMarker(runId, config)
    expect(validateLocalCiMarker(marker, runId, config)).toEqual(marker)
    expect(() =>
      validateLocalCiMarker(marker, runId, Buffer.from(`${config} `)),
    ).toThrow(/marker is invalid/u)
  })

  it('accepts only the exact owned container, image and port binding', () => {
    expect(validateLocalCiContainerInspection(inspection, runId)).toMatchObject(
      {
        image: LOCAL_CI_IMAGE,
        projectId: 'capital-lab-ci-run-12345-1',
      },
    )
    expect(() =>
      validateLocalCiContainerInspection(
        { ...inspection, Config: { Image: 'docker.io/postgres:latest' } },
        runId,
      ),
    ).toThrow(/identity is invalid/u)
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
        runId,
      ),
    ).toThrow(/identity is invalid/u)
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
