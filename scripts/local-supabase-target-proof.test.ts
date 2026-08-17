import { describe, expect, it } from 'vitest'

import {
  buildRestoreTargetProof,
  canonicalJson,
  sha256,
  validateRestoreContainerInspection,
  validateRestoreTargetProof,
} from './lib/local-supabase-target-proof.mjs'
import {
  LOCAL_CI_IMAGE,
  LOCAL_CI_IMAGE_ARCHITECTURE,
  LOCAL_CI_IMAGE_ID,
  LOCAL_CI_IMAGE_OS,
  LOCAL_CI_IMAGE_REPO_DIGEST,
} from './lib/owned-local-ci-stack.mjs'

const inspection = {
  Config: {
    Image: LOCAL_CI_IMAGE,
  },
  Id: 'a'.repeat(64),
  Image: LOCAL_CI_IMAGE_ID,
  Name: '/supabase_db_capital-lab-restore-run-12345',
  NetworkSettings: {
    Ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '55322' }] },
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
const identity = {
  databaseRole: 'postgres',
  databaseIdentity: '170000:postgres:target-system',
  serverIdentity: '170000:target-system',
}
const binding = {
  disposableMarker: '11111111-1111-4111-8111-111111111111',
  markerEvidenceSha256: 'c'.repeat(64),
  runId: 'run-12345',
  sourceServerFingerprint: 'b'.repeat(64),
}

describe('disposable Supabase stack B target proof', () => {
  it('binds the exact running container, loopback port, image and database identity', () => {
    const proof = buildRestoreTargetProof(
      inspection,
      imageInspections,
      identity,
      binding,
      new Date().toISOString(),
    )
    const bytes = Buffer.from(`${canonicalJson(proof)}\n`)
    expect(
      validateRestoreTargetProof(
        bytes,
        sha256(bytes),
        inspection,
        imageInspections,
        identity,
        binding.markerEvidenceSha256,
      ),
    ).toEqual(proof)
    expect(proof).not.toHaveProperty('systemIdentifier')
    expect(proof).not.toHaveProperty('containerId')
  })

  it.each([
    ['wrong name', { Name: '/supabase_db_capital-lab' }],
    ['stopped', { State: { Running: false } }],
    [
      'wrong port',
      {
        NetworkSettings: {
          Ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '54322' }] },
        },
      },
    ],
    [
      'non-loopback',
      {
        NetworkSettings: {
          Ports: { '5432/tcp': [{ HostIp: '0.0.0.0', HostPort: '55322' }] },
        },
      },
    ],
  ])('rejects %s container drift', (_label, mutation) => {
    expect(() =>
      validateRestoreContainerInspection(
        { ...inspection, ...mutation },
        imageInspections,
        binding.runId,
      ),
    ).toThrow(/container binding is invalid/)
  })

  it('rejects proof hash replacement and database identity drift', () => {
    const proof = buildRestoreTargetProof(
      inspection,
      imageInspections,
      identity,
      binding,
      new Date().toISOString(),
    )
    const bytes = Buffer.from(`${canonicalJson(proof)}\n`)
    expect(() =>
      validateRestoreTargetProof(
        bytes,
        'f'.repeat(64),
        inspection,
        imageInspections,
        identity,
        binding.markerEvidenceSha256,
      ),
    ).toThrow(/retained SHA-256/)
    expect(() =>
      validateRestoreTargetProof(
        bytes,
        sha256(bytes),
        inspection,
        imageInspections,
        {
          ...identity,
          serverIdentity: '170000:another-system',
        },
        binding.markerEvidenceSha256,
      ),
    ).toThrow(/stale or non-canonical/)
  })

  it('rejects a reused source cluster, wrong run ID, marker, or database role', () => {
    expect(() =>
      buildRestoreTargetProof(
        inspection,
        imageInspections,
        identity,
        {
          ...binding,
          sourceServerFingerprint: sha256(identity.serverIdentity),
        },
        new Date().toISOString(),
      ),
    ).toThrow(/same PostgreSQL cluster/)
    expect(() =>
      validateRestoreContainerInspection(
        inspection,
        imageInspections,
        'wrong-run',
      ),
    ).toThrow(/container binding/)
    expect(() =>
      buildRestoreTargetProof(
        inspection,
        imageInspections,
        { ...identity, databaseRole: 'service_role' },
        binding,
        new Date().toISOString(),
      ),
    ).toThrow(/database identity/)
  })
})
