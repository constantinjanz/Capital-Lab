import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
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
    const stderrSecret = 'Authorization: Bearer fake-bearer-token'
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
