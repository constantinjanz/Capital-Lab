import { describe, expect, it } from 'vitest'

import {
  assertReproducibleGolden,
  buildBootstrapProvenance,
  parseSchemaGoldenBootstrapOptions,
  propagateLocalMigrationReplayDiagnostic,
  referenceConfig,
  referencePortPlan,
} from './bootstrap-schema-goldens.mjs'
import {
  LOCAL_CI_IMAGE,
  LOCAL_CI_IMAGE_ARCHITECTURE,
  LOCAL_CI_IMAGE_ID,
  LOCAL_CI_IMAGE_OS,
  LOCAL_CI_IMAGE_REGISTRY,
  LOCAL_CI_IMAGE_REPO_DIGEST,
  LOCAL_CI_PROVENANCE_IMAGE,
  canonicalReferenceProjectId,
  canonicalReferenceRunId,
} from './lib/owned-local-ci-stack.mjs'

const sha = 'a'.repeat(40)
const valid = [
  '--confirm=BUILD REVIEWED SEED FREE SCHEMA GOLDENS',
  `--expected-commit-sha=${sha}`,
  '--output-dir=C:/ephemeral/goldens',
  '--run-id=run-12345-1',
]

describe('seed-free schema-Golden bootstrap closure', () => {
  it('accepts exactly the reviewed CLI arguments', () => {
    expect(parseSchemaGoldenBootstrapOptions(valid)).toMatchObject({
      'expected-commit-sha': sha,
      'output-dir': 'C:/ephemeral/goldens',
      'run-id': 'run-12345-1',
    })
  })

  it.each([
    valid.slice(0, -1),
    [...valid, '--run-id=run-other-1'],
    valid.map((value) =>
      value.startsWith('--confirm=') ? '--confirm=unsafe' : value,
    ),
    valid.map((value) =>
      value.startsWith('--expected-commit-sha=')
        ? '--expected-commit-sha=abc'
        : value,
    ),
    [...valid.slice(0, -1), '--source-database=hosted'],
  ])('rejects missing, duplicate, unreviewed, or source arguments', (argv) => {
    expect(() => parseSchemaGoldenBootstrapOptions(argv)).toThrow()
  })

  it('allocates four disjoint loopback stack port sets', () => {
    const plan = referencePortPlan('run-12345-1')
    const ports = plan.flatMap(({ api, db, shadow, studio }) => [
      api,
      db,
      shadow,
      studio,
    ])
    expect(plan).toHaveLength(4)
    expect(new Set(ports).size).toBe(16)
    expect(ports.every((port) => port >= 56_000 && port <= 59_999)).toBe(true)
  })

  it('creates a seed-free service-minimal reference config', () => {
    const config = referenceConfig(
      canonicalReferenceProjectId('run-pre-a-12345-1'),
      {
        api: 56000,
        db: 56001,
        shadow: 56002,
        studio: 56003,
      },
    )
    expect(config).toContain('[db.seed]\nenabled = false\nsql_paths = []')
    expect(config).toContain('[db.migrations]\nenabled = false')
    expect(config).not.toContain('seed.sql')
    expect(config).not.toContain('database_url')
    expect(config).not.toContain('hosted')
  })

  it('requires byte-identical normalized candidates', () => {
    expect(
      assertReproducibleGolden(Buffer.from('same'), Buffer.from('same'), 'pre'),
    ).toEqual(Buffer.from('same'))
    expect(() =>
      assertReproducibleGolden(Buffer.from('a'), Buffer.from('b'), 'post'),
    ).toThrow(/not reproducible/u)
  })

  it('emits only harmless image, cluster, hash, and contract provenance', () => {
    const hash = 'b'.repeat(64)
    const provenance = buildBootstrapProvenance({
      bootstrapContract: {
        contractVersion: 'capital-lab-schema-golden-bootstrap-v1',
        postgresImage: LOCAL_CI_IMAGE,
        postgresImageArchitecture: LOCAL_CI_IMAGE_ARCHITECTURE,
        postgresImageId: LOCAL_CI_IMAGE_ID,
        postgresImageOs: LOCAL_CI_IMAGE_OS,
        postgresImageRegistry: LOCAL_CI_IMAGE_REGISTRY,
        postgresImageRepoDigest: LOCAL_CI_IMAGE_REPO_DIGEST,
        postgresProvenanceImage: LOCAL_CI_PROVENANCE_IMAGE,
        supabaseCliVersion: '2.113.0',
      },
      bootstrapContractSha256: hash,
      gitCommitSha: sha,
      contracts: [
        {
          contractKind: 'pre_activation',
          relationContractVersion: 4,
          relationContractSha256: hash,
          migrationSetSha256: hash,
          rawMigrationSetSha256: hash,
          golden: {
            relationSetSha256: hash,
            schemaFingerprintSha256: hash,
            schemaEvidenceSha256: hash,
          },
          goldenSha256: hash,
          builds: [
            {
              projectId: canonicalReferenceProjectId('run-pre-a-12345-1'),
              evidenceSha256: hash,
              referenceProofSha256: hash,
              serverFingerprint: hash,
              databaseFingerprint: hash,
              containerFingerprint: hash,
              containerImage: LOCAL_CI_IMAGE,
              containerImageArchitecture: LOCAL_CI_IMAGE_ARCHITECTURE,
              containerImageId: LOCAL_CI_IMAGE_ID,
              containerImageOs: LOCAL_CI_IMAGE_OS,
              containerImageRepoDigest: LOCAL_CI_IMAGE_REPO_DIGEST,
            },
          ],
        },
      ],
    })
    const serialized = JSON.stringify(provenance)
    expect(provenance.outputContainsRowData).toBe(false)
    expect(provenance.postgresImageRepoDigest).toBe(LOCAL_CI_IMAGE_REPO_DIGEST)
    expect(provenance.postgresProvenanceImage).toBe(LOCAL_CI_PROVENANCE_IMAGE)
    expect(serialized).not.toMatch(
      /postgresql:|password|authorization|bearer/iu,
    )
    expect(provenance.contracts[0].builds[0].clusterId).toMatch(
      /^capital-lab-ref-pre-a-[0-9a-f]{16}$/u,
    )
  })

  it('derives bounded canonical Reference identities from contract and replica context', () => {
    const preA = canonicalReferenceRunId('run-12345-1', 'pre', 'a')
    const identities = [
      canonicalReferenceProjectId(preA),
      canonicalReferenceProjectId(
        canonicalReferenceRunId('run-12345-1', 'pre', 'b'),
      ),
      canonicalReferenceProjectId(
        canonicalReferenceRunId('run-12345-1', 'post', 'a'),
      ),
      canonicalReferenceProjectId(
        canonicalReferenceRunId('run-12345-1', 'post', 'b'),
      ),
    ]
    expect(canonicalReferenceProjectId(preA)).toBe(identities[0])
    expect(new Set(identities).size).toBe(4)
    expect(identities.every((value) => value.length <= 40)).toBe(true)
    expect(identities.every((value) => /^[a-z0-9-]+$/u.test(value))).toBe(true)
    expect(identities[0]).toMatch(/^capital-lab-ref-pre-a-[0-9a-f]{16}$/u)
    const boundary = canonicalReferenceProjectId(
      canonicalReferenceRunId(`run-${'z'.repeat(28)}`, 'post', 'b'),
    )
    expect(boundary.length).toBeLessThanOrEqual(40)
    expect(() =>
      canonicalReferenceRunId(`run-${'z'.repeat(29)}`, 'post', 'b'),
    ).toThrow()
    expect(() => canonicalReferenceProjectId('run-pre-a-unsafe_1')).toThrow()
  })

  it.each([
    ['pre', 'a'],
    ['pre', 'b'],
    ['post', 'a'],
    ['post', 'b'],
  ] as const)(
    'propagates only the validated replica-bound %s/%s envelope',
    (contract, replica) => {
      const secret = [
        'postgresql',
        '://postgres:',
        'fake-password',
        '@127.0.0.1:59999/postgres',
      ].join('')
      const diagnostic = {
        schemaVersion: 1,
        status: 'local_migration_replay_boundary_observed',
        stage: 'history_preflight',
        role: 'reference',
        contract,
        psqlQueryCompleted: true,
        historySchemaExists: false,
        historyRelationExists: false,
      }
      const writes: string[] = []
      const propagated = propagateLocalMigrationReplayDiagnostic(
        Buffer.from(
          `${secret}\n${JSON.stringify(diagnostic)}\ntoken=fake-child-token\n`,
        ),
        { contract, replica },
        {
          write: (value: string) => {
            writes.push(value)
            return true
          },
        },
      )
      const expected = {
        schemaVersion: 1,
        status: 'schema_golden_reference_migration_replay_observed',
        contract,
        replica,
        localMigrationReplayDiagnostic: diagnostic,
      }
      expect(propagated).toEqual(expected)
      expect(writes).toEqual([`${JSON.stringify(expected)}\n`])
      expect(JSON.parse(writes[0])).not.toEqual(diagnostic)
      expect(writes.join('')).not.toContain(secret)
      expect(writes.join('')).not.toContain('fake-child-token')
    },
  )

  it('rejects context or replica drift and emits nothing after identity rejection', () => {
    const diagnostic = {
      schemaVersion: 1,
      status: 'local_migration_replay_boundary_observed',
      stage: 'history_preflight',
      role: 'reference',
      contract: 'post',
      psqlQueryCompleted: true,
      historySchemaExists: false,
      historyRelationExists: false,
    }
    const writes: string[] = []
    expect(() =>
      propagateLocalMigrationReplayDiagnostic(
        JSON.stringify(diagnostic),
        { contract: 'pre', replica: 'a' },
        {
          write: (value: string) => {
            writes.push(value)
            return true
          },
        },
      ),
    ).toThrow(/context is invalid/u)
    expect(() =>
      propagateLocalMigrationReplayDiagnostic(
        JSON.stringify({ ...diagnostic, contract: 'pre' }),
        { contract: 'pre', replica: 'c' },
        {
          write: (value: string) => {
            writes.push(value)
            return true
          },
        },
      ),
    ).toThrow(/observation is invalid/u)
    expect(
      propagateLocalMigrationReplayDiagnostic(
        JSON.stringify(diagnostic),
        { contract: 'post', replica: 'a' },
        {
          identityRejected: true,
          write: (value: string) => {
            writes.push(value)
            return true
          },
        },
      ),
    ).toBeNull()
    expect(writes).toEqual([])
  })

  it.each([
    ['existing schema', true, false],
    ['existing relation', false, true],
    ['existing schema and relation', true, true],
  ] as const)(
    'rejects Reference envelope with %s',
    (_label, historySchemaExists, historyRelationExists) => {
      const diagnostic = {
        schemaVersion: 1,
        status: 'local_migration_replay_boundary_observed',
        stage: 'history_preflight',
        role: 'reference',
        contract: 'pre',
        psqlQueryCompleted: true,
        historySchemaExists,
        historyRelationExists,
      }
      expect(() =>
        propagateLocalMigrationReplayDiagnostic(JSON.stringify(diagnostic), {
          contract: 'pre',
          replica: 'a',
        }),
      ).toThrow(/observation is invalid/u)
    },
  )
})
