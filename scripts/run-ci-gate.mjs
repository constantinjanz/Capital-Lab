import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadCriticalRelationContract } from './critical-backup-contract.mjs'
import { canonicalRepositoryTextBytes } from './lib/canonical-repository-bytes.mjs'
import {
  resolveNativeExecutable,
  resolvedArguments,
} from './lib/safe-process.mjs'
import { parseLocalContainerIdentityRejection } from './lib/local-container-identity-diagnostic.mjs'
import {
  parseSchemaGoldenReferenceMigrationReplayOutcome,
  requireLocalMigrationReplayDiagnostic,
  serializeLocalMigrationReplayDiagnostic,
  serializeSchemaGoldenReferenceMigrationReplayFailureObservation,
  serializeSchemaGoldenReferenceMigrationReplayObservation,
} from './lib/local-migration-replay-diagnostic.mjs'
import {
  parseLocalRollbackMigrationRehearsalFailureDiagnostic,
  parseLocalRollbackMigrationRehearsalSuccess,
  ROLLBACK_MIGRATION_BASENAMES,
  serializeLocalRollbackMigrationRehearsalFailureDiagnostic,
  serializeLocalRollbackMigrationRehearsalSuccess,
} from './lib/local-rollback-rehearsal-diagnostic.mjs'
import { redactedDiagnosticForCi } from './lib/redacted-supabase-diagnostic.mjs'

const PROCESS_TIMEOUT_MS = 20 * 60 * 1000
const MIGRATION_REPLAY_GATE_CONTEXT = new Map([
  ['database-reset-migrations', { contract: 'post', role: 'source' }],
  ['local-migration-replay-pre', { contract: 'pre', role: 'source' }],
])
const SCHEMA_GOLDEN_BOOTSTRAP_GATE = 'schema-golden-bootstrap'
const LOCAL_ROLLBACK_REHEARSAL_GATE = 'migration-rollback-rehearsal'
const IDENTITY_REJECTION_STATUS = 'local_container_image_identity_rejected'
const COMMIT_SHA = /^[0-9a-f]{40}$/u
const PRE_CONTRACT_PATH = fileURLToPath(
  new URL('../supabase/backup/pre-activation.v1.json', import.meta.url),
)
const POST_CONTRACT_PATH = fileURLToPath(
  new URL('../supabase/backup/post-activation.v1.json', import.meta.url),
)

function semanticJsonStatusCandidates(output, status) {
  const candidates = []
  for (const line of String(output ?? '').split(/\r?\n/u)) {
    try {
      const value = JSON.parse(line)
      if (value?.status === status) candidates.push({ line, value })
    } catch {
      // The strict typed parser handles malformed literal candidates.
    }
  }
  return candidates
}

async function readOptionalFile(filename) {
  try {
    return await readFile(filename, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

async function suppressInvalidIdentityRejectionEvidence(filename) {
  const evidenceDirectory = path.dirname(filename)
  const quarantineDirectory = path.join(
    path.dirname(evidenceDirectory),
    `.schema-golden-replay-rejected-${process.pid}-${Date.now()}`,
  )
  try {
    await rename(evidenceDirectory, quarantineDirectory)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  await mkdir(evidenceDirectory, { recursive: true })
  try {
    await rm(quarantineDirectory, { force: true, recursive: true })
  } catch {
    // The quarantined path is outside the uploaded evidence glob.
  }
}

function requireCiCommitSha() {
  const commitSha = process.env.CAPITAL_LAB_CI_COMMIT_SHA
  if (!COMMIT_SHA.test(commitSha ?? '')) {
    throw new Error('CI commit identity is invalid')
  }
  return commitSha
}

async function requireBufferedIdentityRejection(output, expectedRole) {
  const semanticIdentityRejections = semanticJsonStatusCandidates(
    output,
    IDENTITY_REJECTION_STATUS,
  )
  const identityRejection = parseLocalContainerIdentityRejection(output)
  if (
    semanticIdentityRejections.length !== (identityRejection ? 1 : 0) ||
    (identityRejection &&
      semanticIdentityRejections[0].line !== JSON.stringify(identityRejection))
  ) {
    throw new Error('Container identity rejection output is invalid')
  }
  const persistedIdentityRejection = await readOptionalFile(
    identityRejectionEvidencePath,
  )
  if (
    persistedIdentityRejection !== null &&
    (!identityRejection ||
      persistedIdentityRejection !== `${JSON.stringify(identityRejection)}\n`)
  ) {
    throw new Error('Container identity rejection evidence is invalid')
  }
  if (
    identityRejection &&
    (identityRejection.role !== expectedRole ||
      identityRejection.commitSha !== process.env.CAPITAL_LAB_CI_COMMIT_SHA)
  ) {
    throw new Error('Container identity rejection context is invalid')
  }
  return identityRejection
}

async function schemaGoldenMigrationBasenamesByContract() {
  const [pre, post] = await Promise.all([
    loadCriticalRelationContract(PRE_CONTRACT_PATH, 'pre_activation'),
    loadCriticalRelationContract(POST_CONTRACT_PATH, 'post_activation'),
  ])
  return {
    pre: pre.contract.migrations.map(({ name }) => name),
    post: post.contract.migrations.map(({ name }) => name),
  }
}

async function rollbackMigrationSetSha256() {
  const rows = await Promise.all(
    ROLLBACK_MIGRATION_BASENAMES.map(async (name) => {
      const bytes = await readFile(
        fileURLToPath(
          new URL(`../supabase/migrations/${name}`, import.meta.url),
        ),
      )
      return `${name}:${createHash('sha256')
        .update(canonicalRepositoryTextBytes(bytes))
        .digest('hex')}`
    }),
  )
  return createHash('sha256').update(rows.join('\n')).digest('hex')
}

const separatorIndex = process.argv.indexOf('--')
const idIndex = process.argv.indexOf('--id')
if (
  idIndex < 0 ||
  !process.argv[idIndex + 1] ||
  separatorIndex < 0 ||
  !process.argv[separatorIndex + 1]
) {
  console.error('Usage: run-ci-gate.mjs --id <gate> -- <command> [args...]')
  process.exit(2)
}

const id = process.argv[idIndex + 1]
if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) {
  console.error('Gate id must contain only lowercase letters, digits, _ or -.')
  process.exit(2)
}

const command = process.argv[separatorIndex + 1]
const args = process.argv.slice(separatorIndex + 2)
const startedAt = new Date().toISOString()
let childStdout = ''
let childStderr = ''
const migrationReplayContext = MIGRATION_REPLAY_GATE_CONTEXT.get(id)
const schemaGoldenBootstrapGate = id === SCHEMA_GOLDEN_BOOTSTRAP_GATE
const localRollbackRehearsalGate = id === LOCAL_ROLLBACK_REHEARSAL_GATE
const bufferedGate = Boolean(
  migrationReplayContext ||
  schemaGoldenBootstrapGate ||
  localRollbackRehearsalGate,
)
const identityRejectionEvidencePath = path.join(
  process.cwd(),
  '.ci-evidence',
  'local-container-image-identity-rejected.json',
)

let resolved
try {
  resolved = resolveNativeExecutable(command)
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Gate executable failed',
  )
  process.exit(127)
}
const child = spawn(resolved.command, resolvedArguments(resolved, args), {
  env: process.env,
  shell: false,
  windowsHide: true,
})

child.stdout.on('data', (chunk) => {
  const text = chunk.toString()
  childStdout += text
  if (!bufferedGate) process.stdout.write(text)
})
child.stderr.on('data', (chunk) => {
  const text = chunk.toString()
  childStderr += text
  if (!bufferedGate) process.stderr.write(text)
})

const outcome = await new Promise((resolve) => {
  let settled = false
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    child.kill('SIGTERM')
  }, PROCESS_TIMEOUT_MS)
  child.on('error', () => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    resolve({ exitCode: 127, signal: null, timedOut })
  })
  child.on('close', (code, signal) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    resolve({ exitCode: code ?? 1, signal, timedOut })
  })
})
const originalChildFailed =
  outcome.exitCode !== 0 || outcome.timedOut || Boolean(outcome.signal)
let exitCode = outcome.timedOut || outcome.signal ? 124 : outcome.exitCode
let localMigrationReplayDiagnostic
let localRollbackMigrationRehearsalFailureDiagnostic
let schemaGoldenReferenceMigrationReplayObservations
let schemaGoldenReferenceMigrationReplayFailureObservation
let schemaGoldenDiagnosticEligible = false
if (migrationReplayContext) {
  try {
    const identityRejection = parseLocalContainerIdentityRejection(childStdout)
    if (identityRejection) {
      if (
        identityRejection.role !== migrationReplayContext.role ||
        identityRejection.commitSha !== process.env.CAPITAL_LAB_CI_COMMIT_SHA
      ) {
        throw new Error('Container identity rejection context is invalid')
      }
      if (exitCode === 0) exitCode = 1
      process.stdout.write(`${JSON.stringify(identityRejection)}\n`)
    } else {
      const diagnostic = requireLocalMigrationReplayDiagnostic(childStdout)
      if (
        diagnostic.role !== migrationReplayContext.role ||
        diagnostic.contract !== migrationReplayContext.contract
      ) {
        throw new Error('Migration replay diagnostic context is invalid')
      }
      const serialized = serializeLocalMigrationReplayDiagnostic(diagnostic)
      localMigrationReplayDiagnostic = diagnostic
      process.stdout.write(serialized)
    }
  } catch {
    if (exitCode === 0) exitCode = 1
    process.stderr.write('Migration replay boundary evidence failed closed.\n')
  }
} else if (localRollbackRehearsalGate) {
  try {
    const commitSha = requireCiCommitSha()
    const identityRejection = await requireBufferedIdentityRejection(
      childStdout,
      'source',
    )
    if (identityRejection) {
      if (exitCode === 0) exitCode = 1
      process.stdout.write(`${JSON.stringify(identityRejection)}\n`)
    } else {
      const expectedMigrationSetSha256 = await rollbackMigrationSetSha256()
      const failure =
        parseLocalRollbackMigrationRehearsalFailureDiagnostic(childStdout)
      const success = parseLocalRollbackMigrationRehearsalSuccess(childStdout, {
        expectedCommitSha: commitSha,
        expectedMigrationSetSha256,
      })
      if (exitCode === 0) {
        if (!success || failure) {
          throw new Error('Local rollback rehearsal success is invalid')
        }
        process.stdout.write(
          serializeLocalRollbackMigrationRehearsalSuccess(success, {
            expectedCommitSha: commitSha,
            expectedMigrationSetSha256,
          }),
        )
      } else {
        if (!failure || success) {
          throw new Error('Local rollback rehearsal failure is invalid')
        }
        localRollbackMigrationRehearsalFailureDiagnostic = failure
        process.stdout.write(
          serializeLocalRollbackMigrationRehearsalFailureDiagnostic(failure),
        )
      }
    }
  } catch {
    if (exitCode === 0) exitCode = 1
    process.stderr.write('Rollback rehearsal evidence failed closed.\n')
    try {
      await suppressInvalidIdentityRejectionEvidence(
        identityRejectionEvidencePath,
      )
    } catch {
      // Keep the fixed fail-closed report even if the filesystem is unusable.
    }
  }
} else if (schemaGoldenBootstrapGate) {
  try {
    requireCiCommitSha()
    const identityRejection = await requireBufferedIdentityRejection(
      childStdout,
      'reference',
    )
    if (identityRejection) {
      if (exitCode === 0) exitCode = 1
      process.stdout.write(`${JSON.stringify(identityRejection)}\n`)
    } else {
      schemaGoldenDiagnosticEligible = true
      const migrationBasenames =
        await schemaGoldenMigrationBasenamesByContract()
      const { failureObservation, observations } =
        parseSchemaGoldenReferenceMigrationReplayOutcome(
          childStdout,
          migrationBasenames,
        )
      if (
        (exitCode === 0 && (observations.length !== 4 || failureObservation)) ||
        (exitCode !== 0 && !failureObservation)
      ) {
        throw new Error('Schema Golden replay outcome is incomplete')
      }
      if (observations.length > 0) {
        schemaGoldenReferenceMigrationReplayObservations = observations
        for (const observation of observations) {
          process.stdout.write(
            serializeSchemaGoldenReferenceMigrationReplayObservation(
              observation,
            ),
          )
        }
      }
      if (failureObservation) {
        schemaGoldenReferenceMigrationReplayFailureObservation =
          failureObservation
        process.stdout.write(
          serializeSchemaGoldenReferenceMigrationReplayFailureObservation(
            failureObservation,
            migrationBasenames[failureObservation.contract],
          ),
        )
      }
    }
  } catch {
    if (exitCode === 0) exitCode = 1
    process.stderr.write('Schema Golden replay evidence failed closed.\n')
    try {
      await suppressInvalidIdentityRejectionEvidence(
        identityRejectionEvidencePath,
      )
    } catch {
      // Keep the fixed fail-closed report even if the filesystem is unusable.
    }
  }
}

const normalizedOutput = (
  bufferedGate ? '' : `${childStdout}\n${childStderr}`
).replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
const vitestFiles = normalizedOutput.match(/Test Files\s+(\d+)\s+passed/i)
const vitestTests = normalizedOutput.match(/Tests\s+(\d+)\s+passed/i)
const pgTap = normalizedOutput.match(/Files=(\d+),\s+Tests=(\d+)/i)
const playwrightPassed = normalizedOutput.match(/(?:^|\n)\s*(\d+)\s+passed\b/i)
const playwrightFlaky = normalizedOutput.match(/(?:^|\n)\s*(\d+)\s+flaky\b/i)
const passedTests =
  Number(vitestTests?.[1] ?? pgTap?.[2] ?? playwrightPassed?.[1]) || null
const flakyTests = Number(playwrightFlaky?.[1]) || 0
const evidence = {
  schemaVersion: 2,
  gate: id,
  commitSha: COMMIT_SHA.test(process.env.CAPITAL_LAB_CI_COMMIT_SHA ?? '')
    ? process.env.CAPITAL_LAB_CI_COMMIT_SHA
    : null,
  startedAt,
  completedAt: new Date().toISOString(),
  exitCode,
  signal: outcome.signal,
  timedOut: outcome.timedOut,
  counts: {
    files: Number(vitestFiles?.[1] ?? pgTap?.[1]) || null,
    tests: passedTests === null ? null : passedTests + flakyTests,
    passed: passedTests,
    flaky: flakyTests,
  },
}
const diagnosticInput =
  schemaGoldenBootstrapGate &&
  schemaGoldenDiagnosticEligible &&
  originalChildFailed &&
  !schemaGoldenReferenceMigrationReplayFailureObservation
    ? childStdout
    : normalizedOutput
const redactedDiagnostic = redactedDiagnosticForCi(id, diagnosticInput, {
  exitCode,
  signal: outcome.signal,
  timedOut: outcome.timedOut,
})
if (redactedDiagnostic) evidence.redactedDiagnostic = redactedDiagnostic
if (localMigrationReplayDiagnostic) {
  evidence.localMigrationReplayDiagnostic = localMigrationReplayDiagnostic
}
if (localRollbackMigrationRehearsalFailureDiagnostic) {
  evidence.localRollbackMigrationRehearsalFailureDiagnostic =
    localRollbackMigrationRehearsalFailureDiagnostic
}
if (schemaGoldenReferenceMigrationReplayObservations) {
  evidence.schemaGoldenReferenceMigrationReplayObservations =
    schemaGoldenReferenceMigrationReplayObservations
}
if (schemaGoldenReferenceMigrationReplayFailureObservation) {
  evidence.schemaGoldenReferenceMigrationReplayFailureObservation =
    schemaGoldenReferenceMigrationReplayFailureObservation
}

const evidenceDirectory = path.join(process.cwd(), '.ci-evidence')
await mkdir(evidenceDirectory, { recursive: true })
await writeFile(
  path.join(evidenceDirectory, `${id}.json`),
  `${JSON.stringify(evidence, null, 2)}\n`,
  'utf8',
)

process.exit(exitCode)
