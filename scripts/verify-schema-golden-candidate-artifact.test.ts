import { describe, expect, it } from 'vitest'

import {
  parseSchemaGoldenCandidateOptions,
  validateSchemaGoldenCandidateProvenance,
} from './verify-schema-golden-candidate-artifact.mjs'
import { canonicalJson, sha256 } from './critical-backup-contract.mjs'

const commit = 'a'.repeat(40)
const hash = 'b'.repeat(64)
const bootstrap = {
  contractVersion: 'capital-lab-schema-golden-bootstrap-v1',
  postgresImage: 'public.ecr.aws/supabase/postgres:17.6.1.158',
  postgresImageRegistry: 'public.ecr.aws/supabase',
  supabaseCliVersion: '2.113.0',
}

function provenance() {
  const payload = {
    schemaVersion: 1,
    contractVersion: bootstrap.contractVersion,
    gitCommitSha: commit,
    supabaseCliVersion: bootstrap.supabaseCliVersion,
    postgresImageRegistry: bootstrap.postgresImageRegistry,
    postgresImage: bootstrap.postgresImage,
    bootstrapContractSha256: hash,
    outputContainsRowData: false,
    contracts: ['pre_activation', 'post_activation'].map((kind) => ({
      contractKind: kind,
      relationContractVersion: 4,
      relationContractSha256: hash,
      migrationSetSha256: hash,
      rawMigrationSetSha256: hash,
      relationSetSha256: hash,
      schemaFingerprintSha256: hash,
      schemaEvidenceSha256: hash,
      goldenSha256: hash,
      builds: ['a', 'b'].map((replica, index) => ({
        clusterId: `capital-lab-reference-run-${kind.startsWith('pre') ? 'pre' : 'post'}-${replica}-12345-1`,
        referenceEvidenceSha256: `${index + 1}`.repeat(64),
        referenceProofSha256: `${index + 3}`.repeat(64),
        serverFingerprint: `${index + 5}`.repeat(64),
        databaseFingerprint: `${index + 7}`.repeat(64),
        containerFingerprint: `${index + 8}`.repeat(64),
      })),
    })),
  }
  return { ...payload, evidenceSha256: sha256(canonicalJson(payload)) }
}

const expected = {
  bootstrap,
  bootstrapContractSha256: hash,
  gitCommitSha: commit,
  goldens: {
    pre_activation: {
      sha256: hash,
      relationContractSha256: hash,
      relationSetSha256: hash,
      schemaEvidenceSha256: hash,
      schemaFingerprintSha256: hash,
    },
    post_activation: {
      sha256: hash,
      relationContractSha256: hash,
      relationSetSha256: hash,
      schemaEvidenceSha256: hash,
      schemaFingerprintSha256: hash,
    },
  },
}

describe('schema-Golden candidate artifact verifier', () => {
  it('requires an exact external artifact and commit CLI boundary', () => {
    expect(
      parseSchemaGoldenCandidateOptions([
        '--directory=C:/ephemeral/candidate',
        `--expected-commit-sha=${commit}`,
      ]),
    ).toMatchObject({ directory: 'C:/ephemeral/candidate' })
    expect(() =>
      parseSchemaGoldenCandidateOptions([
        '--directory=C:/ephemeral/candidate',
        '--expected-commit-sha=abc',
      ]),
    ).toThrow()
  })

  it('accepts two isolated builds per exact candidate', () => {
    expect(() =>
      validateSchemaGoldenCandidateProvenance(provenance(), expected),
    ).not.toThrow()
  })

  it.each([
    [
      'row-data claim',
      (value: ReturnType<typeof provenance>) => {
        value.outputContainsRowData = true
      },
    ],
    [
      'wrong image',
      (value: ReturnType<typeof provenance>) => {
        value.postgresImage = 'docker.io/attacker/postgres:latest'
      },
    ],
    [
      'same cluster',
      (value: ReturnType<typeof provenance>) => {
        value.contracts[0].builds[1].clusterId =
          value.contracts[0].builds[0].clusterId
      },
    ],
    [
      'same container',
      (value: ReturnType<typeof provenance>) => {
        value.contracts[0].builds[1].containerFingerprint =
          value.contracts[0].builds[0].containerFingerprint
      },
    ],
    [
      'extra field',
      (value: ReturnType<typeof provenance>) => {
        Object.assign(value, { databaseUrl: 'forbidden' })
      },
    ],
  ])('rejects %s provenance', (_label, mutate) => {
    const value = provenance()
    mutate(value)
    expect(() =>
      validateSchemaGoldenCandidateProvenance(value, expected),
    ).toThrow()
  })
})
