import { spawnSync } from 'node:child_process'
import {
  existsSync,
  linkSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import {
  LocalContainerImageIdentityRejection,
  localContainerInspectFailureDiagnostic,
  serializeLocalContainerIdentityRejection,
} from './lib/local-container-identity-diagnostic.mjs'

const runner = fileURLToPath(new URL('./run-ci-gate.mjs', import.meta.url))
const tempDirectories: string[] = []
const diagnostic = {
  schemaVersion: 1,
  status: 'local_migration_replay_boundary_observed',
  stage: 'history_preflight',
  role: 'source',
  contract: 'pre',
  psqlQueryCompleted: true,
  historySchemaExists: false,
  historyRelationExists: false,
}
const referenceSequence = [
  ['pre', 'a'],
  ['pre', 'b'],
  ['post', 'a'],
  ['post', 'b'],
].map(([contract, replica]) => ({
  schemaVersion: 1,
  status: 'schema_golden_reference_migration_replay_observed',
  contract,
  replica,
  localMigrationReplayDiagnostic: {
    ...diagnostic,
    role: 'reference',
    contract,
  },
}))
const referenceFailure = {
  schemaVersion: 1,
  status: 'schema_golden_reference_migration_replay_failure_observed',
  contract: 'pre',
  replica: 'a',
  localMigrationReplayFailureDiagnostic: {
    schemaVersion: 1,
    status: 'local_migration_replay_failure_observed',
    role: 'reference',
    contract: 'pre',
    stage: 'migration_apply',
    migrationBasename: '20260806165114_private_storage.sql',
    completedMigrationCount: 8,
    psqlExitCode: 1,
    sqlstate: '42P01',
    signal: null,
    timedOut: false,
  },
}
const rollbackFailure = {
  schemaVersion: 1,
  status: 'local_rollback_migration_rehearsal_failure_observed',
  role: 'source',
  contract: 'pre',
  stage: 'migration_body',
  migrationBasename: '20260809150000_post_build_hosting_safety.sql',
  completedMigrationCount: 0,
  psqlExitCode: 1,
  sqlstate: '42P01',
  signal: null,
  timedOut: false,
}
const rollbackSuccess = {
  commitSha: 'f'.repeat(40),
  migrationCount: 4,
  migrationSetSha256:
    'f52c276233744c3a5abc2d02570a528ea8ca399d8c1a0bcc014c176b20a83c96',
  status: 'rollback_verified',
}

function tempDirectory() {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), 'capital-lab-ci-gate-diagnostic-'),
  )
  tempDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

describe('CI gate migration replay diagnostic', () => {
  it('persists and emits only validated evidence while preserving failure status', () => {
    const directory = tempDirectory()
    const stdoutSecret = [
      'postgresql',
      '://postgres:',
      'fake-password',
      '@127.0.0.1:59999/postgres',
    ].join('')
    const stderrSecret = [
      'Author',
      'ization: Bear',
      'er fake-bearer-token',
    ].join('')
    const child = [
      `process.stdout.write(${JSON.stringify(`untrusted ${stdoutSecret}\n`)})`,
      `process.stdout.write(${JSON.stringify(`${JSON.stringify(diagnostic)}\n`)})`,
      `process.stdout.write(${JSON.stringify('token=fake-child-token\n')})`,
      `process.stderr.write(${JSON.stringify(`${stderrSecret}\n`)})`,
      'process.exit(7)',
    ].join(';')
    const outcome = spawnSync(
      process.execPath,
      [runner, '--id', 'local-migration-replay-pre', '--', 'node', '-e', child],
      {
        cwd: directory,
        encoding: 'utf8',
        env: { ...process.env, CAPITAL_LAB_CI_COMMIT_SHA: 'e'.repeat(40) },
      },
    )
    const evidenceText = readFileSync(
      path.join(directory, '.ci-evidence', 'local-migration-replay-pre.json'),
      'utf8',
    )
    const evidence = JSON.parse(evidenceText)
    expect(outcome.status).toBe(7)
    expect(outcome.stdout).toBe(`${JSON.stringify(diagnostic)}\n`)
    expect(outcome.stderr).toBe('')
    expect(evidence).toMatchObject({
      exitCode: 7,
      localMigrationReplayDiagnostic: diagnostic,
    })
    for (const forbidden of [
      stdoutSecret,
      stderrSecret,
      'fake-child-token',
      'untrusted',
    ]) {
      expect(`${outcome.stdout}${outcome.stderr}${evidenceText}`).not.toContain(
        forbidden,
      )
    }
  })

  it('fails closed without inventing evidence when the diagnosis is missing', () => {
    const directory = tempDirectory()
    const outcome = spawnSync(
      process.execPath,
      [
        runner,
        '--id',
        'local-migration-replay-pre',
        '--',
        'node',
        '-e',
        "process.stdout.write('token=fake-missing-diagnostic')",
      ],
      { cwd: directory, encoding: 'utf8' },
    )
    const evidenceText = readFileSync(
      path.join(directory, '.ci-evidence', 'local-migration-replay-pre.json'),
      'utf8',
    )
    const evidence = JSON.parse(evidenceText)
    expect(outcome.status).toBe(1)
    expect(outcome.stdout).toBe('')
    expect(outcome.stderr).toBe(
      'Migration replay boundary evidence failed closed.\n',
    )
    expect(evidence.localMigrationReplayDiagnostic).toBeUndefined()
    expect(`${outcome.stdout}${outcome.stderr}${evidenceText}`).not.toContain(
      'fake-missing-diagnostic',
    )
  })

  it('preserves only validated identity rejection and emits no later diagnosis', () => {
    const directory = tempDirectory()
    const commitSha = 'e'.repeat(40)
    const rejection = serializeLocalContainerIdentityRejection(
      new LocalContainerImageIdentityRejection(
        'source',
        localContainerInspectFailureDiagnostic(
          'container_inspect',
          'container_inspect_unavailable',
          {
            container: 'supabase_db_capital-lab-ci-run-12345-1',
            port: '54322',
            projectId: 'capital-lab-ci-run-12345-1',
          },
        ),
      ),
      commitSha,
    )
    const child = [
      `process.stdout.write(${JSON.stringify(rejection)})`,
      `process.stdout.write(${JSON.stringify(`${JSON.stringify(diagnostic)}\n`)})`,
      `process.stderr.write('token=fake-identity-secret')`,
      'process.exit(1)',
    ].join(';')
    const outcome = spawnSync(
      process.execPath,
      [runner, '--id', 'local-migration-replay-pre', '--', 'node', '-e', child],
      {
        cwd: directory,
        encoding: 'utf8',
        env: { ...process.env, CAPITAL_LAB_CI_COMMIT_SHA: commitSha },
      },
    )
    const evidenceText = readFileSync(
      path.join(directory, '.ci-evidence', 'local-migration-replay-pre.json'),
      'utf8',
    )
    const evidence = JSON.parse(evidenceText)
    expect(outcome.status).toBe(1)
    expect(outcome.stdout).toBe(rejection)
    expect(outcome.stderr).toBe('')
    expect(evidence.localMigrationReplayDiagnostic).toBeUndefined()
    expect(`${outcome.stdout}${outcome.stderr}${evidenceText}`).not.toContain(
      'fake-identity-secret',
    )
    expect(outcome.stdout).not.toContain(
      'local_migration_replay_boundary_observed',
    )
  })
})

describe('CI gate local rollback rehearsal outcome', () => {
  function runRollbackGate(
    directory: string,
    output: string,
    childExitCode: number,
    commitSha = 'f'.repeat(40),
    persistedIdentityEvidence: string | null = null,
  ) {
    const stdoutSecret = [
      'postgresql',
      '://postgres:',
      'fake-rollback-password',
      '@127.0.0.1:59999/postgres',
    ].join('')
    const stderrSecret = [
      'Author',
      'ization: Bear',
      'er fake-rollback-secret',
    ].join('')
    const identityEvidencePath = path.join(
      directory,
      '.ci-evidence',
      'local-container-image-identity-rejected.json',
    )
    const child = [
      ...(persistedIdentityEvidence === null
        ? []
        : [
            "require('node:fs').mkdirSync('.ci-evidence',{recursive:true})",
            `require('node:fs').writeFileSync(${JSON.stringify(identityEvidencePath)},${JSON.stringify(persistedIdentityEvidence)})`,
          ]),
      `process.stdout.write(${JSON.stringify(`raw ${stdoutSecret}\n${output}token=fake-rollback-token\n`)})`,
      `process.stderr.write(${JSON.stringify(stderrSecret)})`,
      `process.exit(${childExitCode})`,
    ].join(';')
    const outcome = spawnSync(
      process.execPath,
      [
        runner,
        '--id',
        'migration-rollback-rehearsal',
        '--',
        'node',
        '-e',
        child,
      ],
      {
        cwd: directory,
        encoding: 'utf8',
        env: { ...process.env, CAPITAL_LAB_CI_COMMIT_SHA: commitSha },
      },
    )
    const evidenceText = readFileSync(
      path.join(directory, '.ci-evidence', 'migration-rollback-rehearsal.json'),
      'utf8',
    )
    return {
      evidence: JSON.parse(evidenceText),
      evidenceText,
      identityEvidencePath,
      outcome,
      secrets: [stdoutSecret, 'fake-rollback-token', 'fake-rollback-secret'],
    }
  }

  it('evaluates exact Source identity before local migration-set files', () => {
    const source = readFileSync(runner, 'utf8')
    const branch = source.indexOf('} else if (localRollbackRehearsalGate) {')
    const identity = source.indexOf(
      'await requireBufferedIdentityRejection(',
      branch,
    )
    const migrationSet = source.indexOf(
      'await rollbackMigrationSetSha256()',
      branch,
    )
    expect(branch).toBeGreaterThanOrEqual(0)
    expect(identity).toBeGreaterThan(branch)
    expect(migrationSet).toBeGreaterThan(identity)
  })

  it('persists only one canonical failure and preserves the child nonzero', () => {
    const result = runRollbackGate(
      tempDirectory(),
      `${JSON.stringify(rollbackFailure)}\n`,
      7,
    )
    expect(result.outcome.status).toBe(7)
    expect(result.outcome.stdout).toBe(`${JSON.stringify(rollbackFailure)}\n`)
    expect(result.outcome.stderr).toBe('')
    expect(result.evidence).toMatchObject({
      exitCode: 7,
      localRollbackMigrationRehearsalFailureDiagnostic: rollbackFailure,
      counts: { files: null, tests: null, passed: null, flaky: 0 },
    })
    expect(result.evidence.redactedDiagnostic).toBeUndefined()
    for (const secret of result.secrets) {
      expect(
        `${result.outcome.stdout}${result.outcome.stderr}${result.evidenceText}`,
      ).not.toContain(secret)
    }
  })

  it('preserves the exact strict success without creating failure evidence', () => {
    const result = runRollbackGate(
      tempDirectory(),
      `${JSON.stringify(rollbackSuccess)}\n`,
      0,
    )
    expect(result.outcome.status).toBe(0)
    expect(result.outcome.stdout).toBe(`${JSON.stringify(rollbackSuccess)}\n`)
    expect(result.outcome.stderr).toBe('')
    expect(
      result.evidence.localRollbackMigrationRehearsalFailureDiagnostic,
    ).toBeUndefined()
    expect(result.evidence.redactedDiagnostic).toBeUndefined()
  })

  it('rejects success when the exact CI commit identity is unavailable', () => {
    const secret = ['Author', 'ization: Bear', 'er fake-env-secret'].join('')
    const result = runRollbackGate(
      tempDirectory(),
      `${JSON.stringify(rollbackSuccess)}\n`,
      0,
      secret,
    )
    expect(result.outcome.status).toBe(1)
    expect(result.outcome.stdout).toBe('')
    expect(result.outcome.stderr).toBe(
      'Rollback rehearsal evidence failed closed.\n',
    )
    expect(
      result.evidence.localRollbackMigrationRehearsalFailureDiagnostic,
    ).toBeUndefined()
    expect(result.evidence.commitSha).toBeNull()
    expect(
      `${result.outcome.stdout}${result.outcome.stderr}${result.evidenceText}`,
    ).not.toContain(secret)
  })

  it.each([
    ['missing diagnosis', '', 7, 7],
    [
      'success and failure together',
      `${JSON.stringify(rollbackSuccess)}\n${JSON.stringify(rollbackFailure)}\n`,
      0,
      1,
    ],
    ['failure on child success', `${JSON.stringify(rollbackFailure)}\n`, 0, 1],
    [
      'success with a wrong migration-set identity',
      `${JSON.stringify({
        ...rollbackSuccess,
        migrationSetSha256: 'a'.repeat(64),
      })}\n`,
      0,
      1,
    ],
    [
      'success plus an unclosed escaped failure candidate',
      `${JSON.stringify(rollbackSuccess)}\n{"statu\\u0073":"local_rollback_migration_rehearsal_failure_observe\\u0064`,
      0,
      1,
    ],
    [
      'failure plus an unclosed escaped success candidate',
      `${JSON.stringify(rollbackFailure)}\n{"statu\\u0073":"rollback_verifie\\u0064`,
      7,
      7,
    ],
  ] as const)(
    'fails closed for %s without typed evidence',
    (_label, output, childExitCode, expectedExitCode) => {
      const result = runRollbackGate(tempDirectory(), output, childExitCode)
      expect(result.outcome.status).toBe(expectedExitCode)
      expect(result.outcome.stdout).toBe('')
      expect(result.outcome.stderr).toBe(
        'Rollback rehearsal evidence failed closed.\n',
      )
      expect(
        result.evidence.localRollbackMigrationRehearsalFailureDiagnostic,
      ).toBeUndefined()
      expect(result.evidence.redactedDiagnostic).toBeUndefined()
    },
  )

  it('gives an exact-commit Source identity rejection exclusive priority', () => {
    const directory = tempDirectory()
    const commitSha = 'f'.repeat(40)
    const rejection = serializeLocalContainerIdentityRejection(
      new LocalContainerImageIdentityRejection(
        'source',
        localContainerInspectFailureDiagnostic(
          'container_inspect',
          'container_inspect_unavailable',
          {
            container: 'supabase_db_capital-lab-ci-run-12345-1',
            port: '54322',
            projectId: 'capital-lab-ci-run-12345-1',
          },
        ),
      ),
      commitSha,
    )
    const result = runRollbackGate(
      directory,
      `${JSON.stringify(rollbackFailure)}\n${rejection}`,
      1,
      commitSha,
      rejection,
    )
    expect(result.outcome.status).toBe(1)
    expect(result.outcome.stdout).toBe(rejection)
    expect(result.outcome.stderr).toBe('')
    expect(
      result.evidence.localRollbackMigrationRehearsalFailureDiagnostic,
    ).toBeUndefined()
    expect(readFileSync(result.identityEvidencePath, 'utf8')).toBe(rejection)
    expect(result.outcome.stdout).not.toContain(
      'local_rollback_migration_rehearsal_failure_observed',
    )
  })

  it('rejects and quarantines a wrong-context identity rejection', () => {
    const directory = tempDirectory()
    const commitSha = 'f'.repeat(40)
    const rejection = serializeLocalContainerIdentityRejection(
      new LocalContainerImageIdentityRejection(
        'reference',
        localContainerInspectFailureDiagnostic(
          'container_inspect',
          'container_inspect_unavailable',
          {
            container: 'supabase_db_capital-lab-ref-pre-a-0123456789abcdef',
            port: '56001',
            projectId: 'capital-lab-ref-pre-a-0123456789abcdef',
          },
        ),
      ),
      commitSha,
    )
    const result = runRollbackGate(
      directory,
      rejection,
      8,
      commitSha,
      rejection,
    )
    expect(result.outcome.status).toBe(8)
    expect(result.outcome.stdout).toBe('')
    expect(result.outcome.stderr).toBe(
      'Rollback rehearsal evidence failed closed.\n',
    )
    expect(existsSync(result.identityEvidencePath)).toBe(false)
    expect(result.evidenceText).not.toContain(
      'local_container_image_identity_rejected',
    )
  })
})

describe('CI gate schema-Golden Reference replay sequence', () => {
  function runGoldenGate(
    directory: string,
    output: string,
    childExitCode: number,
    commitSha = 'f'.repeat(40),
    persistedIdentityEvidence:
      string | { nestedIdentityEvidence: string } | null = null,
  ) {
    const stdoutSecret = [
      'postgresql',
      '://postgres:',
      'fake-golden-password',
      '@127.0.0.1:59999/postgres',
    ].join('')
    const stderrSecret = [
      'Author',
      'ization: Bear',
      'er fake-golden-secret',
    ].join('')
    const identityEvidencePath = path.join(
      directory,
      '.ci-evidence',
      'local-container-image-identity-rejected.json',
    )
    const child = [
      ...(persistedIdentityEvidence === null
        ? []
        : typeof persistedIdentityEvidence === 'string'
          ? [
              "require('node:fs').mkdirSync('.ci-evidence',{recursive:true})",
              `require('node:fs').writeFileSync(${JSON.stringify(identityEvidencePath)},${JSON.stringify(persistedIdentityEvidence)})`,
            ]
          : [
              "require('node:fs').mkdirSync('.ci-evidence',{recursive:true})",
              `require('node:fs').mkdirSync(${JSON.stringify(identityEvidencePath)})`,
              `require('node:fs').writeFileSync(${JSON.stringify(path.join(identityEvidencePath, 'raw.json'))},${JSON.stringify(persistedIdentityEvidence.nestedIdentityEvidence)})`,
            ]),
      `process.stdout.write(${JSON.stringify(`raw ${stdoutSecret}\n${output}token=fake-child-token\n`)})`,
      `process.stderr.write(${JSON.stringify(stderrSecret)})`,
      `process.exit(${childExitCode})`,
    ].join(';')
    const outcome = spawnSync(
      process.execPath,
      [runner, '--id', 'schema-golden-bootstrap', '--', 'node', '-e', child],
      {
        cwd: directory,
        encoding: 'utf8',
        env: { ...process.env, CAPITAL_LAB_CI_COMMIT_SHA: commitSha },
      },
    )
    const evidenceText = readFileSync(
      path.join(directory, '.ci-evidence', 'schema-golden-bootstrap.json'),
      'utf8',
    )
    return {
      evidence: JSON.parse(evidenceText),
      evidenceText,
      identityEvidencePath,
      outcome,
      secrets: [stdoutSecret, 'fake-child-token', 'fake-golden-secret'],
    }
  }

  function serialized(values = referenceSequence) {
    return `${values.map((value) => JSON.stringify(value)).join('\n')}\n`
  }

  it('accepts exactly pre/a, pre/b, post/a, post/b on child success', () => {
    const directory = tempDirectory()
    const result = runGoldenGate(directory, serialized(), 0)
    expect(result.outcome.status).toBe(0)
    expect(result.outcome.stdout).toBe(serialized())
    expect(result.outcome.stderr).toBe('')
    expect(result.evidence).toMatchObject({
      exitCode: 0,
      schemaGoldenReferenceMigrationReplayObservations: referenceSequence,
    })
    expect(result.evidence.localMigrationReplayDiagnostic).toBeUndefined()
    expect(
      result.evidence.schemaGoldenReferenceMigrationReplayFailureObservation,
    ).toBeUndefined()
    expect(result.evidence.redactedDiagnostic).toBeUndefined()
    for (const secret of result.secrets) {
      expect(
        `${result.outcome.stdout}${result.outcome.stderr}${result.evidenceText}`,
      ).not.toContain(secret)
    }
  })

  it('preserves a pre/a prefix plus exactly one bound failure', () => {
    const directory = tempDirectory()
    const output = `${serialized(referenceSequence.slice(0, 1))}${JSON.stringify(referenceFailure)}\n`
    const result = runGoldenGate(directory, output, 7)
    expect(result.outcome.status).toBe(7)
    expect(result.outcome.stderr).toBe('')
    expect(result.outcome.stdout).toBe(output)
    expect(
      result.evidence.schemaGoldenReferenceMigrationReplayObservations,
    ).toEqual(referenceSequence.slice(0, 1))
    expect(
      result.evidence.schemaGoldenReferenceMigrationReplayFailureObservation,
    ).toEqual(referenceFailure)
    expect(result.evidence.redactedDiagnostic).toBeUndefined()
    for (const secret of result.secrets) {
      expect(
        `${result.outcome.stdout}${result.outcome.stderr}${result.evidenceText}`,
      ).not.toContain(secret)
    }
  })

  it.each([0, 1, 2, 3, 4])(
    'rejects nonzero child output with a boundary prefix but no failure at length %i',
    (length) => {
      const result = runGoldenGate(
        tempDirectory(),
        serialized(referenceSequence.slice(0, length)),
        7,
      )
      expect(result.outcome.status).toBe(7)
      expect(result.outcome.stdout).toBe('')
      expect(result.outcome.stderr).toBe(
        'Schema Golden replay evidence failed closed.\n',
      )
      expect(
        result.evidence.schemaGoldenReferenceMigrationReplayObservations,
      ).toBeUndefined()
      expect(
        result.evidence.schemaGoldenReferenceMigrationReplayFailureObservation,
      ).toBeUndefined()
    },
  )

  it.each([0, 1, 2, 3])(
    'turns child success with incomplete prefix length %i into failure',
    (length) => {
      const directory = tempDirectory()
      const result = runGoldenGate(
        directory,
        serialized(referenceSequence.slice(0, length)),
        0,
      )
      expect(result.outcome.status).toBe(1)
      expect(result.outcome.stdout).toBe('')
      expect(result.outcome.stderr).toBe(
        'Schema Golden replay evidence failed closed.\n',
      )
      expect(
        result.evidence.schemaGoldenReferenceMigrationReplayObservations,
      ).toBeUndefined()
    },
  )

  it.each([
    [
      'failure with no matching boundary',
      `${JSON.stringify(referenceFailure)}\n`,
    ],
    [
      'contract drift',
      `${serialized(referenceSequence.slice(0, 1))}${JSON.stringify({
        ...referenceFailure,
        contract: 'post',
      })}\n`,
    ],
    [
      'replica drift',
      `${serialized(referenceSequence.slice(0, 1))}${JSON.stringify({
        ...referenceFailure,
        replica: 'b',
      })}\n`,
    ],
    [
      'nested role drift',
      `${serialized(referenceSequence.slice(0, 1))}${JSON.stringify({
        ...referenceFailure,
        localMigrationReplayFailureDiagnostic: {
          ...referenceFailure.localMigrationReplayFailureDiagnostic,
          role: 'source',
        },
      })}\n`,
    ],
    [
      'wrong migration/count binding',
      `${serialized(referenceSequence.slice(0, 1))}${JSON.stringify({
        ...referenceFailure,
        localMigrationReplayFailureDiagnostic: {
          ...referenceFailure.localMigrationReplayFailureDiagnostic,
          completedMigrationCount: 7,
        },
      })}\n`,
    ],
    [
      'duplicate failure',
      `${serialized(referenceSequence.slice(0, 1))}${JSON.stringify(referenceFailure)}\n${JSON.stringify(referenceFailure)}\n`,
    ],
    [
      'boundary after terminal failure',
      `${serialized(referenceSequence.slice(0, 1))}${JSON.stringify(referenceFailure)}\n${JSON.stringify(referenceSequence[1])}\n`,
    ],
  ])('rejects %s without persisting either typed field', (_label, output) => {
    const result = runGoldenGate(tempDirectory(), output, 9)
    expect(result.outcome.status).toBe(9)
    expect(result.outcome.stdout).toBe('')
    expect(result.outcome.stderr).toBe(
      'Schema Golden replay evidence failed closed.\n',
    )
    expect(
      result.evidence.schemaGoldenReferenceMigrationReplayObservations,
    ).toBeUndefined()
    expect(
      result.evidence.schemaGoldenReferenceMigrationReplayFailureObservation,
    ).toBeUndefined()
    expect(result.evidence.redactedDiagnostic).toBeUndefined()
  })

  it.each([
    ['duplicate', [referenceSequence[0], referenceSequence[0]], 0, 1],
    ['swapped', [referenceSequence[1], referenceSequence[0]], 9, 9],
    ['fifth', [...referenceSequence, referenceSequence[3]], 0, 1],
    ['wrong replica', [{ ...referenceSequence[0], replica: 'c' }], 9, 9],
    ['contract drift', [{ ...referenceSequence[0], contract: 'post' }], 9, 9],
    [
      'nested role drift',
      [
        {
          ...referenceSequence[0],
          localMigrationReplayDiagnostic: {
            ...referenceSequence[0].localMigrationReplayDiagnostic,
            role: 'source',
          },
        },
      ],
      9,
      9,
    ],
    [
      'nested Boolean drift',
      [
        {
          ...referenceSequence[0],
          localMigrationReplayDiagnostic: {
            ...referenceSequence[0].localMigrationReplayDiagnostic,
            historyRelationExists: true,
          },
        },
      ],
      9,
      9,
    ],
  ] as const)(
    'rejects %s sequence without persisting it',
    (_label, values, childExitCode, expectedExitCode) => {
      const directory = tempDirectory()
      const result = runGoldenGate(
        directory,
        serialized([...values]),
        childExitCode,
      )
      expect(result.outcome.status).toBe(expectedExitCode)
      expect(result.outcome.stdout).toBe('')
      expect(result.outcome.stderr).toBe(
        'Schema Golden replay evidence failed closed.\n',
      )
      expect(
        result.evidence.schemaGoldenReferenceMigrationReplayObservations,
      ).toBeUndefined()
    },
  )

  it('gives a valid exact-commit Reference identity rejection priority', () => {
    const directory = tempDirectory()
    const commitSha = 'f'.repeat(40)
    const rejection = serializeLocalContainerIdentityRejection(
      new LocalContainerImageIdentityRejection(
        'reference',
        localContainerInspectFailureDiagnostic(
          'container_inspect',
          'container_inspect_unavailable',
          {
            container: 'supabase_db_capital-lab-ref-pre-a-0123456789abcdef',
            port: '56001',
            projectId: 'capital-lab-ref-pre-a-0123456789abcdef',
          },
        ),
      ),
      commitSha,
    )
    const result = runGoldenGate(
      directory,
      `${serialized()}${rejection}`,
      1,
      commitSha,
      rejection,
    )
    expect(result.outcome.status).toBe(1)
    expect(result.outcome.stdout).toBe(rejection)
    expect(result.outcome.stderr).toBe('')
    expect(
      result.evidence.schemaGoldenReferenceMigrationReplayObservations,
    ).toBeUndefined()
    expect(result.evidence.localMigrationReplayDiagnostic).toBeUndefined()
    expect(readFileSync(result.identityEvidencePath, 'utf8')).toBe(rejection)
  })

  it.each([
    ['wrong role', 'source', 'f'.repeat(40)],
    ['wrong commit', 'reference', 'e'.repeat(40)],
  ] as const)(
    'rejects identity rejection with %s and suppresses every envelope',
    (_label, role, rejectionCommit) => {
      const directory = tempDirectory()
      const expectedCommit = 'f'.repeat(40)
      const rejection = serializeLocalContainerIdentityRejection(
        new LocalContainerImageIdentityRejection(
          role,
          localContainerInspectFailureDiagnostic(
            'container_inspect',
            'container_inspect_unavailable',
            {
              container: 'supabase_db_capital-lab-ref-pre-a-0123456789abcdef',
              port: '56001',
              projectId: 'capital-lab-ref-pre-a-0123456789abcdef',
            },
          ),
        ),
        rejectionCommit,
      )
      const result = runGoldenGate(
        directory,
        `${serialized()}${rejection}`,
        8,
        expectedCommit,
        rejection,
      )
      expect(result.outcome.status).toBe(8)
      expect(result.outcome.stdout).toBe('')
      expect(result.outcome.stderr).toBe(
        'Schema Golden replay evidence failed closed.\n',
      )
      expect(
        result.evidence.schemaGoldenReferenceMigrationReplayObservations,
      ).toBeUndefined()
      expect(result.evidenceText).not.toContain(
        'local_container_image_identity_rejected',
      )
      expect(existsSync(result.identityEvidencePath)).toBe(false)
    },
  )

  it('rejects a JSON-escaped fifth envelope as noncanonical', () => {
    const directory = tempDirectory()
    const escapedFifth = JSON.stringify(referenceSequence[3]).replace(
      'schema_golden_reference_migration_replay_observed',
      'schema_golden_reference_migration_replay_observe\\u0064',
    )
    const result = runGoldenGate(
      directory,
      `${serialized()}${escapedFifth}\n`,
      0,
    )
    expect(result.outcome.status).toBe(1)
    expect(result.outcome.stdout).toBe('')
    expect(result.outcome.stderr).toBe(
      'Schema Golden replay evidence failed closed.\n',
    )
    expect(
      result.evidence.schemaGoldenReferenceMigrationReplayObservations,
    ).toBeUndefined()
  })

  it.each([
    ['wrong', 'wrong'],
    ['missing', undefined],
  ] as const)(
    'rejects an envelope-shaped fifth output with %s status',
    (_label, status) => {
      const directory = tempDirectory()
      const fifth = { ...referenceSequence[3], status }
      if (status === undefined) delete fifth.status
      const result = runGoldenGate(
        directory,
        `${serialized()}${JSON.stringify(fifth)}\n`,
        0,
      )
      expect(result.outcome.status).toBe(1)
      expect(result.outcome.stdout).toBe('')
      expect(result.outcome.stderr).toBe(
        'Schema Golden replay evidence failed closed.\n',
      )
      expect(
        result.evidence.schemaGoldenReferenceMigrationReplayObservations,
      ).toBeUndefined()
    },
  )

  it('rejects a syntactically malformed fifth envelope without a status', () => {
    const directory = tempDirectory()
    const result = runGoldenGate(
      directory,
      `${serialized()}{"replic\\u0061":"b","localMigrationReplayDiagnosti\\u0063":\n`,
      0,
    )
    expect(result.outcome.status).toBe(1)
    expect(result.outcome.stdout).toBe('')
    expect(result.outcome.stderr).toBe(
      'Schema Golden replay evidence failed closed.\n',
    )
    expect(
      result.evidence.schemaGoldenReferenceMigrationReplayObservations,
    ).toBeUndefined()
  })

  it('rejects a syntactically malformed multiline fifth envelope', () => {
    const directory = tempDirectory()
    const result = runGoldenGate(
      directory,
      `${serialized()}{\n  "status":"wrong",\n  "replica":"b",\n  "localMigrationReplayDiagnostic":\n}\n`,
      0,
    )
    expect(result.outcome.status).toBe(1)
    expect(result.outcome.stdout).toBe('')
    expect(result.outcome.stderr).toBe(
      'Schema Golden replay evidence failed closed.\n',
    )
    expect(
      result.evidence.schemaGoldenReferenceMigrationReplayObservations,
    ).toBeUndefined()
  })

  it.each([
    [
      'an unmatched log quote before a fifth object',
      'noise "\n{\n  "status":"wrong",\n  "replica":"b",\n  "localMigrationReplayDiagnostic":\n}\n',
    ],
    [
      'an unclosed escaped expected-status object',
      '{"status":"schema_golden_reference_migration_replay_observe\\u0064","localMigrationReplayDiagnostic":{\n',
    ],
    [
      'an unclosed escaped expected-status string',
      '{"statu\\u0073":"schema_golden_reference_migration_replay_observe\\u0064',
    ],
  ])('rejects %s', (_label, malformed) => {
    const directory = tempDirectory()
    const result = runGoldenGate(directory, `${serialized()}${malformed}`, 0)
    expect(result.outcome.status).toBe(1)
    expect(result.outcome.stdout).toBe('')
    expect(result.outcome.stderr).toBe(
      'Schema Golden replay evidence failed closed.\n',
    )
    expect(
      result.evidence.schemaGoldenReferenceMigrationReplayObservations,
    ).toBeUndefined()
  })

  it('quarantines invalid identity evidence when the exact path is not a file', () => {
    const directory = tempDirectory()
    const expectedCommit = 'f'.repeat(40)
    const rejection = serializeLocalContainerIdentityRejection(
      new LocalContainerImageIdentityRejection(
        'source',
        localContainerInspectFailureDiagnostic(
          'container_inspect',
          'container_inspect_unavailable',
          {
            container: 'supabase_db_capital-lab-ref-pre-a-0123456789abcdef',
            port: '56001',
            projectId: 'capital-lab-ref-pre-a-0123456789abcdef',
          },
        ),
      ),
      expectedCommit,
    )
    const result = runGoldenGate(
      directory,
      `${serialized()}${rejection}`,
      8,
      expectedCommit,
      { nestedIdentityEvidence: rejection },
    )
    expect(result.outcome.status).toBe(8)
    expect(result.outcome.stdout).toBe('')
    expect(result.outcome.stderr).toBe(
      'Schema Golden replay evidence failed closed.\n',
    )
    expect(existsSync(result.identityEvidencePath)).toBe(false)
    expect(result.evidenceText).not.toContain(
      'local_container_image_identity_rejected',
    )
    expect(
      result.evidence.schemaGoldenReferenceMigrationReplayObservations,
    ).toBeUndefined()
  })

  it('removes a linked invalid identity path without changing its peer', () => {
    const directory = tempDirectory()
    const expectedCommit = 'f'.repeat(40)
    const rejection = serializeLocalContainerIdentityRejection(
      new LocalContainerImageIdentityRejection(
        'source',
        localContainerInspectFailureDiagnostic(
          'container_inspect',
          'container_inspect_unavailable',
          {
            container: 'supabase_db_capital-lab-ref-pre-a-0123456789abcdef',
            port: '56001',
            projectId: 'capital-lab-ref-pre-a-0123456789abcdef',
          },
        ),
      ),
      expectedCommit,
    )
    const evidenceDirectory = path.join(directory, '.ci-evidence')
    const identityEvidencePath = path.join(
      evidenceDirectory,
      'local-container-image-identity-rejected.json',
    )
    const outsidePath = path.join(directory, 'outside-identity.json')
    mkdirSync(evidenceDirectory)
    writeFileSync(outsidePath, rejection)
    linkSync(outsidePath, identityEvidencePath)
    const result = runGoldenGate(
      directory,
      `${serialized()}${rejection}`,
      8,
      expectedCommit,
    )
    expect(result.outcome.status).toBe(8)
    expect(result.outcome.stdout).toBe('')
    expect(result.outcome.stderr).toBe(
      'Schema Golden replay evidence failed closed.\n',
    )
    expect(existsSync(identityEvidencePath)).toBe(false)
    expect(readFileSync(outsidePath, 'utf8')).toBe(rejection)
    expect(result.evidenceText).not.toContain(
      'local_container_image_identity_rejected',
    )
  })

  it('quarantines every uploadable hardlink to invalid identity evidence', () => {
    const directory = tempDirectory()
    const expectedCommit = 'f'.repeat(40)
    const rejection = serializeLocalContainerIdentityRejection(
      new LocalContainerImageIdentityRejection(
        'source',
        localContainerInspectFailureDiagnostic(
          'container_inspect',
          'container_inspect_unavailable',
          {
            container: 'supabase_db_capital-lab-ref-pre-a-0123456789abcdef',
            port: '56001',
            projectId: 'capital-lab-ref-pre-a-0123456789abcdef',
          },
        ),
      ),
      expectedCommit,
    )
    const evidenceDirectory = path.join(directory, '.ci-evidence')
    const peerPath = path.join(
      evidenceDirectory,
      'alternate-invalid-rejection.json',
    )
    const identityEvidencePath = path.join(
      evidenceDirectory,
      'local-container-image-identity-rejected.json',
    )
    mkdirSync(evidenceDirectory)
    writeFileSync(peerPath, rejection)
    linkSync(peerPath, identityEvidencePath)
    const result = runGoldenGate(
      directory,
      `${serialized()}${rejection}`,
      8,
      expectedCommit,
    )
    expect(result.outcome.status).toBe(8)
    expect(result.outcome.stdout).toBe('')
    expect(result.outcome.stderr).toBe(
      'Schema Golden replay evidence failed closed.\n',
    )
    expect(existsSync(identityEvidencePath)).toBe(false)
    expect(existsSync(peerPath)).toBe(false)
    expect(result.evidenceText).not.toContain(
      'local_container_image_identity_rejected',
    )
  })

  it('quarantines an alternate invalid rejection file from the upload glob', () => {
    const directory = tempDirectory()
    const expectedCommit = 'f'.repeat(40)
    const rejection = serializeLocalContainerIdentityRejection(
      new LocalContainerImageIdentityRejection(
        'source',
        localContainerInspectFailureDiagnostic(
          'container_inspect',
          'container_inspect_unavailable',
          {
            container: 'supabase_db_capital-lab-ref-pre-a-0123456789abcdef',
            port: '56001',
            projectId: 'capital-lab-ref-pre-a-0123456789abcdef',
          },
        ),
      ),
      expectedCommit,
    )
    const evidenceDirectory = path.join(directory, '.ci-evidence')
    const alternatePath = path.join(
      evidenceDirectory,
      'alternate-invalid-rejection.json',
    )
    mkdirSync(evidenceDirectory)
    writeFileSync(alternatePath, rejection)
    const result = runGoldenGate(
      directory,
      `${serialized()}${rejection}`,
      8,
      expectedCommit,
    )
    expect(result.outcome.status).toBe(8)
    expect(result.outcome.stdout).toBe('')
    expect(result.outcome.stderr).toBe(
      'Schema Golden replay evidence failed closed.\n',
    )
    expect(existsSync(alternatePath)).toBe(false)
    expect(result.evidenceText).not.toContain(
      'local_container_image_identity_rejected',
    )
  })

  it('detects an escaped wrong-context identity rejection and removes its file', () => {
    const directory = tempDirectory()
    const expectedCommit = 'f'.repeat(40)
    const rejection = serializeLocalContainerIdentityRejection(
      new LocalContainerImageIdentityRejection(
        'source',
        localContainerInspectFailureDiagnostic(
          'container_inspect',
          'container_inspect_unavailable',
          {
            container: 'supabase_db_capital-lab-ref-pre-a-0123456789abcdef',
            port: '56001',
            projectId: 'capital-lab-ref-pre-a-0123456789abcdef',
          },
        ),
      ),
      expectedCommit,
    )
    const escapedRejection = rejection.replace(
      'local_container_image_identity_rejected',
      'local_container_image_identity_rejecte\\u0064',
    )
    const result = runGoldenGate(
      directory,
      `${serialized()}${escapedRejection}`,
      8,
      expectedCommit,
      rejection,
    )
    expect(result.outcome.status).toBe(8)
    expect(result.outcome.stdout).toBe('')
    expect(result.outcome.stderr).toBe(
      'Schema Golden replay evidence failed closed.\n',
    )
    expect(
      result.evidence.schemaGoldenReferenceMigrationReplayObservations,
    ).toBeUndefined()
    expect(result.evidenceText).not.toContain(
      'local_container_image_identity_rejected',
    )
    expect(existsSync(result.identityEvidencePath)).toBe(false)
  })
})
