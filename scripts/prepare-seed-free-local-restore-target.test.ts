import { describe, expect, it, vi } from 'vitest'

import {
  executeDestructiveReset,
  validateDestructiveResetBinding,
} from './prepare-seed-free-local-restore-target.mjs'
import {
  buildRestoreTargetProof,
  sha256,
} from './lib/local-supabase-target-proof.mjs'
import {
  LOCAL_CI_IMAGE,
  LOCAL_CI_IMAGE_ARCHITECTURE,
  LOCAL_CI_IMAGE_ID,
  LOCAL_CI_IMAGE_OS,
  LOCAL_CI_IMAGE_REPO_DIGEST,
} from './lib/owned-local-ci-stack.mjs'

const inspection = {
  Config: { Image: LOCAL_CI_IMAGE },
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
const targetIdentity = {
  databaseRole: 'postgres',
  databaseIdentity: '170000:postgres:target-system',
  serverIdentity: '170000:target-system',
}
const proofBinding = {
  disposableMarker: '11111111-1111-4111-8111-111111111111',
  markerEvidenceSha256: 'c'.repeat(64),
  runId: 'run-12345',
  sourceServerFingerprint: 'b'.repeat(64),
}
const preparedAt = '2026-08-12T12:00:00.000Z'
const target = {
  hostname: '127.0.0.1',
  port: '55322',
  database: 'postgres',
}

function binding() {
  return {
    proof: buildRestoreTargetProof(
      inspection,
      imageInspections,
      targetIdentity,
      proofBinding,
      preparedAt,
    ),
    inspection,
    imageInspections,
    targetIdentity,
    proofBinding,
    preparedAt,
    target,
  }
}

type BindingMutation = {
  imageInspections?: typeof imageInspections
  proof?: Partial<ReturnType<typeof buildRestoreTargetProof>>
  target?: Partial<typeof target>
  proofBinding?: Partial<typeof proofBinding>
}

const invalidBindings: Array<[string, BindingMutation]> = [
  [
    'wrong immutable image identity',
    {
      imageInspections: [{ ...imageInspections[0], RepoDigests: [] }],
    },
  ],
  ['wrong database', { proof: { database: 'template1' } }],
  ['wrong port', { target: { port: '54322' } }],
  [
    'same source cluster',
    {
      proofBinding: {
        sourceServerFingerprint: sha256(targetIdentity.serverIdentity),
      },
    },
  ],
  [
    'wrong marker',
    { proof: { disposableMarker: '22222222-2222-4222-8222-222222222222' } },
  ],
]

describe('destructive local restore target orchestration', () => {
  it('starts the destructive action only after the exact proof is valid', async () => {
    const action = vi.fn().mockResolvedValue('completed')
    await expect(executeDestructiveReset(binding(), action)).resolves.toBe(
      'completed',
    )
    expect(action).toHaveBeenCalledTimes(1)
    expect(validateDestructiveResetBinding(binding())).toEqual(binding().proof)
  })

  it.each(invalidBindings)(
    'does not spawn for %s',
    async (_label, mutation) => {
      const original = binding()
      const candidate = {
        ...original,
        ...mutation,
        proof: { ...original.proof, ...mutation.proof },
        target: { ...original.target, ...mutation.target },
        proofBinding: { ...original.proofBinding, ...mutation.proofBinding },
      }
      const action = vi.fn()
      await expect(executeDestructiveReset(candidate, action)).rejects.toThrow()
      expect(action).not.toHaveBeenCalled()
    },
  )
})
