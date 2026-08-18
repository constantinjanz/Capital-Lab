import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  resolveNativeExecutable,
  resolvedArguments,
} from './lib/safe-process.mjs'
import { parseLocalContainerIdentityRejection } from './lib/local-container-identity-diagnostic.mjs'
import {
  requireLocalMigrationReplayDiagnostic,
  serializeLocalMigrationReplayDiagnostic,
} from './lib/local-migration-replay-diagnostic.mjs'
import { redactedDiagnosticForCi } from './lib/redacted-supabase-diagnostic.mjs'

const PROCESS_TIMEOUT_MS = 20 * 60 * 1000
const MIGRATION_REPLAY_GATE_CONTEXT = new Map([
  ['database-reset-migrations', { contract: 'post', role: 'source' }],
  ['local-migration-replay-pre', { contract: 'pre', role: 'source' }],
  ['schema-golden-bootstrap', { contract: 'pre', role: 'reference' }],
])

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
  if (!migrationReplayContext) process.stdout.write(text)
})
child.stderr.on('data', (chunk) => {
  const text = chunk.toString()
  childStderr += text
  if (!migrationReplayContext) process.stderr.write(text)
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
let exitCode = outcome.timedOut || outcome.signal ? 124 : outcome.exitCode
let localMigrationReplayDiagnostic
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
}

const normalizedOutput = `${childStdout}\n${childStderr}`.replace(
  /\u001b\[[0-?]*[ -/]*[@-~]/g,
  '',
)
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
  commitSha: process.env.CAPITAL_LAB_CI_COMMIT_SHA ?? null,
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
const redactedDiagnostic = redactedDiagnosticForCi(id, normalizedOutput, {
  exitCode,
  signal: outcome.signal,
  timedOut: outcome.timedOut,
})
if (redactedDiagnostic) evidence.redactedDiagnostic = redactedDiagnostic
if (localMigrationReplayDiagnostic) {
  evidence.localMigrationReplayDiagnostic = localMigrationReplayDiagnostic
}

const evidenceDirectory = path.join(process.cwd(), '.ci-evidence')
await mkdir(evidenceDirectory, { recursive: true })
await writeFile(
  path.join(evidenceDirectory, `${id}.json`),
  `${JSON.stringify(evidence, null, 2)}\n`,
  'utf8',
)

process.exit(exitCode)
