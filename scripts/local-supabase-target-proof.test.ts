import { describe, expect, it } from 'vitest'

import {
  buildRestoreTargetProof,
  canonicalJson,
  sha256,
  validateRestoreContainerInspection,
  validateRestoreTargetProof,
} from './lib/local-supabase-target-proof.mjs'

const inspection = {
  Config: {
    Image: 'public.ecr.aws/supabase/postgres:17.6.1.001',
  },
  Id: 'a'.repeat(64),
  Name: '/supabase_db_capital-lab-restore-run-12345',
  NetworkSettings: {
    Ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '55322' }] },
  },
  State: { Running: true },
}
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
        binding.runId,
      ),
    ).toThrow(/container identity is invalid/)
  })

  it('rejects proof hash replacement and database identity drift', () => {
    const proof = buildRestoreTargetProof(
      inspection,
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
        identity,
        binding.markerEvidenceSha256,
      ),
    ).toThrow(/retained SHA-256/)
    expect(() =>
      validateRestoreTargetProof(
        bytes,
        sha256(bytes),
        inspection,
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
        identity,
        {
          ...binding,
          sourceServerFingerprint: sha256(identity.serverIdentity),
        },
        new Date().toISOString(),
      ),
    ).toThrow(/same PostgreSQL cluster/)
    expect(() =>
      validateRestoreContainerInspection(inspection, 'wrong-run'),
    ).toThrow(/container identity/)
    expect(() =>
      buildRestoreTargetProof(
        inspection,
        { ...identity, databaseRole: 'service_role' },
        binding,
        new Date().toISOString(),
      ),
    ).toThrow(/database identity/)
  })
})
