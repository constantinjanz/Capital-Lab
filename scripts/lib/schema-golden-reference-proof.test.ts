import { describe, expect, it } from 'vitest'

import {
  buildSchemaGoldenReferenceProof,
  validateSchemaGoldenReferenceProof,
} from './schema-golden-reference-proof.mjs'
import { sha256 } from '../critical-backup-contract.mjs'
import {
  LOCAL_CI_IMAGE,
  LOCAL_CI_IMAGE_ARCHITECTURE,
  LOCAL_CI_IMAGE_ID,
  LOCAL_CI_IMAGE_OS,
  LOCAL_CI_IMAGE_REGISTRY,
  LOCAL_CI_IMAGE_REPO_DIGEST,
} from './owned-local-ci-stack.mjs'

const referenceIdentity = {
  databaseRole: 'postgres',
  serverIdentity: '170000:reference-system',
  databaseIdentity: '170000:postgres:reference-system',
}
const peerReferenceIdentity = {
  databaseRole: 'postgres',
  serverIdentity: '170000:source-system',
  databaseIdentity: '170000:postgres:source-system',
}
const base = {
  contractKind: 'pre_activation',
  runId: 'run-reference1',
  projectId: 'capital-lab-reference-run-reference1',
  hostname: '127.0.0.1',
  port: '56322',
  database: 'postgres',
  databaseRole: 'postgres',
  gitCommitSha: 'a'.repeat(40),
  relationContractSha256: 'b'.repeat(64),
  migrationHistorySha256: 'c'.repeat(64),
  serverFingerprint: sha256(referenceIdentity.serverIdentity),
  databaseFingerprint: sha256(referenceIdentity.databaseIdentity),
  containerFingerprint: 'd'.repeat(64),
  containerImage: LOCAL_CI_IMAGE,
  containerImageArchitecture: LOCAL_CI_IMAGE_ARCHITECTURE,
  containerImageId: LOCAL_CI_IMAGE_ID,
  containerImageOs: LOCAL_CI_IMAGE_OS,
  containerImageRegistry: LOCAL_CI_IMAGE_REGISTRY,
  containerImageRepoDigest: LOCAL_CI_IMAGE_REPO_DIGEST,
  supabaseCliVersion: '2.113.0',
  bootstrapContractSha256: 'e'.repeat(64),
  seedFree: true,
  builtFromReviewedMigrations: true,
  capturedAt: '2026-08-12T12:00:00.000Z',
}
const bootstrapContract = {
  contractVersion: 'capital-lab-schema-golden-bootstrap-v1',
  postgresImage: base.containerImage,
  postgresImageArchitecture: base.containerImageArchitecture,
  postgresImageId: base.containerImageId,
  postgresImageOs: base.containerImageOs,
  postgresImageRegistry: base.containerImageRegistry,
  postgresImageRepoDigest: base.containerImageRepoDigest,
  supabaseCliVersion: base.supabaseCliVersion,
}
const expected = {
  contractKind: base.contractKind,
  gitCommitSha: base.gitCommitSha,
  relationContractSha256: base.relationContractSha256,
  migrationHistorySha256: base.migrationHistorySha256,
  bootstrapContract,
  bootstrapContractSha256: base.bootstrapContractSha256,
  sha256,
}
const invalidProvenance: Array<
  [
    string,
    typeof referenceIdentity,
    typeof peerReferenceIdentity,
    Partial<typeof base>?,
  ]
> = [
  ['same server', peerReferenceIdentity, peerReferenceIdentity],
  ['seeded', referenceIdentity, peerReferenceIdentity, { seedFree: false }],
  [
    'not migration built',
    referenceIdentity,
    peerReferenceIdentity,
    { builtFromReviewedMigrations: false },
  ],
  [
    'wrong contract',
    referenceIdentity,
    peerReferenceIdentity,
    { contractKind: 'post_activation' },
  ],
  [
    'ECR runtime reference',
    referenceIdentity,
    peerReferenceIdentity,
    { containerImage: 'public.ecr.aws/supabase/postgres:17.6.1.158' },
  ],
  [
    'wrong image ID',
    referenceIdentity,
    peerReferenceIdentity,
    { containerImageId: `sha256:${'f'.repeat(64)}` },
  ],
  [
    'wrong RepoDigest',
    referenceIdentity,
    peerReferenceIdentity,
    {
      containerImageRepoDigest: `ghcr.io/supabase/postgres@sha256:${'f'.repeat(64)}`,
    },
  ],
  [
    'wrong OS',
    referenceIdentity,
    peerReferenceIdentity,
    { containerImageOs: 'windows' },
  ],
  [
    'wrong architecture',
    referenceIdentity,
    peerReferenceIdentity,
    { containerImageArchitecture: 'arm64' },
  ],
]

describe('independent schema-golden reference proof', () => {
  it('binds one seed-free migration-built cluster to a distinct peer Reference cluster', () => {
    const proof = buildSchemaGoldenReferenceProof(base, bootstrapContract)
    expect(() =>
      validateSchemaGoldenReferenceProof(
        proof,
        expected,
        referenceIdentity,
        peerReferenceIdentity,
      ),
    ).not.toThrow()
  })

  it.each(invalidProvenance)(
    'rejects %s proof provenance',
    (_label, reference, source, mutation = {}) => {
      expect(() => {
        const proof = buildSchemaGoldenReferenceProof(
          { ...base, ...mutation },
          bootstrapContract,
        )
        validateSchemaGoldenReferenceProof(proof, expected, reference, source)
      }).toThrow()
    },
  )
})
