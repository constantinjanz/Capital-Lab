import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  assertReproducibleGolden,
  buildBootstrapProvenance,
  parseSchemaGoldenBootstrapOptions,
  propagateLocalMigrationReplayDiagnostic,
  propagateLocalMigrationReplayOutcome,
  referenceConfig,
  referencePortPlan,
  referenceStartArguments,
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
const migrationBasenames = [
  '20260801000000_first.sql',
  '20260801000001_second.sql',
]

function replayBoundary(contract: 'pre' | 'post' = 'pre') {
  return {
    schemaVersion: 1,
    status: 'local_migration_replay_boundary_observed',
    stage: 'history_preflight',
    role: 'reference',
    contract,
    psqlQueryCompleted: true,
    historySchemaExists: false,
    historyRelationExists: false,
  }
}

function replayFailure(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    status: 'local_migration_replay_failure_observed',
    role: 'reference',
    contract: 'pre',
    stage: 'migration_apply',
    migrationBasename: migrationBasenames[1],
    completedMigrationCount: 1,
    psqlExitCode: 3,
    sqlstate: '42P01',
    signal: null,
    timedOut: false,
    ...overrides,
  }
}

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
    expect(plan.map(({ contract, replica }) => [contract, replica])).toEqual([
      ['pre', 'a'],
      ['pre', 'b'],
      ['post', 'a'],
      ['post', 'b'],
    ])
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
    expect(config).toContain(
      '[storage]\nenabled = true\nfile_size_limit = "25MiB"',
    )
    for (const section of [
      'api',
      'studio',
      'auth',
      'realtime',
      'edge_runtime',
      'analytics',
      'inbucket',
    ]) {
      expect(config).toContain(`[${section}]\nenabled = false`)
    }
    expect(config).toContain('[db.seed]\nenabled = false\nsql_paths = []')
    expect(config).toContain(
      '[db.migrations]\nenabled = false\nschema_paths = []',
    )
    expect(config).not.toContain('seed.sql')
    expect(config).not.toContain('database_url')
    expect(config).not.toContain('hosted')
    expect(config).not.toContain('imgproxy')
    expect(config).not.toMatch(/\bcreate\s+(?:schema|table)\b/iu)
  })

  it('gives only every PRE/POST Reference replica the exact exclude token', () => {
    const workspace = path.resolve('reviewed-workspace')
    const referenceDirectory = path.resolve('owned-reference')
    for (const build of referencePortPlan('run-12345-1')) {
      const args = referenceStartArguments(
        { ...build, directory: referenceDirectory },
        workspace,
      )
      expect(args).toEqual([
        path.join(workspace, 'scripts', 'run-redacted-subprocess.mjs'),
        `--id=golden-${build.contract}-${build.replica}-start`,
        '--role=reference',
        '--',
        'supabase',
        'start',
        `--workdir=${referenceDirectory}`,
        '--exclude=storage-api',
      ])
      expect(
        args.filter((value) => value === '--exclude=storage-api'),
      ).toHaveLength(1)
      expect(args.join('\n')).not.toContain('imgproxy')
    }
  })

  it('keeps Source and Restore starts unchanged and adds no manual Storage DDL', () => {
    const source = readFileSync(
      new URL('./bootstrap-schema-goldens.mjs', import.meta.url),
      'utf8',
    )
    const workflow = readFileSync(
      new URL('../.github/workflows/ci.yml', import.meta.url),
      'utf8',
    )
    expect(source.match(/--exclude=storage-api/gu)).toHaveLength(1)
    expect(source.toLowerCase()).not.toContain('storage.buckets')
    expect(source).not.toMatch(/\bcreate\s+(?:schema|table)\b[^\n]*storage/iu)
    expect(workflow).not.toContain('--exclude')
    expect(workflow).toContain(
      '--role=source -- supabase start "--workdir=${CAPITAL_LAB_CI_WORKDIR}"',
    )
    expect(workflow.match(/--role=restore -- supabase start/gu)).toHaveLength(2)
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

  it('evaluates the complete failed child before emitting Boundary then Failure', () => {
    const boundary = replayBoundary()
    const failure = replayFailure()
    const secret = [
      'postgresql',
      '://postgres:',
      'fake-password',
      '@127.0.0.1/postgres',
    ].join('')
    const writes: string[] = []
    const propagated = propagateLocalMigrationReplayOutcome(
      {
        code: 1,
        signal: null,
        timedOut: false,
        stdout: Buffer.from(
          `${secret}\n${JSON.stringify(boundary)}\n${JSON.stringify(failure)}\ntoken=fake-child-token\n`,
        ),
      },
      { contract: 'pre', replica: 'a' },
      migrationBasenames,
      {
        write: (value: string) => {
          writes.push(value)
          return true
        },
      },
    )
    const observation = {
      schemaVersion: 1,
      status: 'schema_golden_reference_migration_replay_observed',
      contract: 'pre',
      replica: 'a',
      localMigrationReplayDiagnostic: boundary,
    }
    const failureObservation = {
      schemaVersion: 1,
      status: 'schema_golden_reference_migration_replay_failure_observed',
      contract: 'pre',
      replica: 'a',
      localMigrationReplayFailureDiagnostic: failure,
    }
    expect(propagated).toEqual({ observation, failureObservation })
    expect(writes).toEqual([
      `${JSON.stringify(observation)}\n`,
      `${JSON.stringify(failureObservation)}\n`,
    ])
    expect(writes.join('')).not.toContain(secret)
    expect(writes.join('')).not.toContain('fake-child-token')
  })

  it('keeps the completed Reference replay path Boundary-only', () => {
    const boundary = replayBoundary('post')
    const writes: string[] = []
    expect(
      propagateLocalMigrationReplayOutcome(
        {
          code: 0,
          signal: null,
          timedOut: false,
          stdout: `${JSON.stringify(boundary)}\n${JSON.stringify({ status: 'local_migrations_replayed', contract: 'post', migrationCount: 2, seed: 'omit' })}\n`,
        },
        { contract: 'post', replica: 'b' },
        migrationBasenames,
        {
          write: (value: string) => {
            writes.push(value)
            return true
          },
        },
      ),
    ).toEqual({
      observation: {
        schemaVersion: 1,
        status: 'schema_golden_reference_migration_replay_observed',
        contract: 'post',
        replica: 'b',
        localMigrationReplayDiagnostic: boundary,
      },
      failureObservation: null,
    })
    expect(writes).toHaveLength(1)
  })

  it('emits nothing for incomplete, contradictory, or drifted child evidence', () => {
    const boundary = replayBoundary()
    const failure = replayFailure()
    for (const [outcome, expected] of [
      [
        {
          code: 1,
          signal: null,
          timedOut: false,
          stdout: JSON.stringify(boundary),
        },
        { contract: 'pre', replica: 'a' },
      ],
      [
        {
          code: 0,
          signal: null,
          timedOut: false,
          stdout: `${JSON.stringify(boundary)}\n${JSON.stringify(failure)}`,
        },
        { contract: 'pre', replica: 'a' },
      ],
      [
        {
          code: 1,
          signal: null,
          timedOut: false,
          stdout: `${JSON.stringify(boundary)}\n${JSON.stringify(failure)}`,
        },
        { contract: 'post', replica: 'a' },
      ],
    ] as const) {
      const writes: string[] = []
      expect(() =>
        propagateLocalMigrationReplayOutcome(
          outcome,
          expected,
          migrationBasenames,
          {
            write: (value: string) => {
              writes.push(value)
              return true
            },
          },
        ),
      ).toThrow()
      expect(writes).toEqual([])
    }
  })

  it('keeps identity evaluation ahead of replay evidence and stops before capture', () => {
    const source = readFileSync(
      new URL('./bootstrap-schema-goldens.mjs', import.meta.url),
      'utf8',
    )
    const child = source.indexOf('async function applyReferenceMigrations')
    const identity = source.indexOf(
      'parseLocalContainerIdentityRejection(outcome.stdout)',
      child,
    )
    const propagation = source.indexOf(
      'propagateLocalMigrationReplayOutcome(outcome',
      identity,
    )
    const mainLoop = source.lastIndexOf('for (const build of pair)')
    const start = source.indexOf('await startReference(build', mainLoop)
    const imageIdentity = source.indexOf(
      'verifyReferenceImageIdentity(build)',
      start,
    )
    const apply = source.indexOf('await applyReferenceMigrations(', mainLoop)
    const captures = source.indexOf('const captures = []', apply)
    expect(identity).toBeGreaterThan(child)
    expect(propagation).toBeGreaterThan(identity)
    expect(start).toBeGreaterThan(mainLoop)
    expect(imageIdentity).toBeGreaterThan(start)
    expect(apply).toBeGreaterThan(imageIdentity)
    expect(captures).toBeGreaterThan(apply)
  })

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
