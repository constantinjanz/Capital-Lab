import { spawn } from 'node:child_process'
import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  buildRedactedSupabaseDiagnostic,
  validateRedactedSupabaseDiagnostic,
} from './lib/redacted-supabase-diagnostic.mjs'
import {
  LOCAL_CI_RESET_CONFIRMATION,
  localCiConfig,
  validateLocalCiMarker,
} from './lib/owned-local-ci-stack.mjs'
import { inspectOwnedDatabaseContainer } from './lib/local-container-postgres.mjs'
import { verifiedExternalDirectory } from './lib/safe-artifact-path.mjs'
import {
  resolvedArguments,
  resolveNativeExecutable,
} from './lib/safe-process.mjs'

const PROCESS_TIMEOUT_MS = 12 * 60 * 1000

export function parseOwnedResetOptions(argv) {
  const entries = argv.map((argument) => {
    const match = /^--(confirm|run-id|workdir)=(.+)$/u.exec(argument)
    if (!match) throw new Error('Owned reset arguments are invalid')
    return [match[1], match[2]]
  })
  const parsed = Object.fromEntries(entries)
  if (
    entries.length !== 3 ||
    new Set(entries.map(([key]) => key)).size !== 3 ||
    parsed.confirm !== LOCAL_CI_RESET_CONFIRMATION
  ) {
    throw new Error('Exact owned reset authority is required')
  }
  return parsed
}

async function runPrivate(command, args, options = {}) {
  const executable = resolveNativeExecutable(command)
  return new Promise((resolve) => {
    let stdout = Buffer.alloc(0)
    let stderr = Buffer.alloc(0)
    let settled = false
    let timedOut = false
    let forceTimer
    const append = (current, chunk) =>
      Buffer.concat([current, Buffer.from(chunk)]).subarray(-1024 * 1024)
    const child = spawn(
      executable.command,
      resolvedArguments(executable, args),
      {
        cwd: options.cwd,
        env: process.env,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    child.stdout.on('data', (chunk) => (stdout = append(stdout, chunk)))
    child.stderr.on('data', (chunk) => (stderr = append(stderr, chunk)))
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      forceTimer = setTimeout(() => child.kill('SIGKILL'), 5_000)
    }, options.timeoutMs ?? PROCESS_TIMEOUT_MS)
    const finish = (code, signal, spawnError = false) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(forceTimer)
      resolve({ code, signal, timedOut, spawnError, stdout, stderr })
    }
    child.once('error', () => finish(null, null, true))
    child.once('close', (code, signal) => finish(code, signal))
  })
}

async function main() {
  const requested = parseOwnedResetOptions(process.argv.slice(2))
  const workspace = await realpath(process.cwd())
  const workdir = await verifiedExternalDirectory(
    workspace,
    await realpath(path.resolve(requested.workdir)),
  )
  const configBytes = await readFile(
    path.join(workdir, 'supabase', 'config.toml'),
  )
  if (!configBytes.equals(Buffer.from(localCiConfig(requested['run-id'])))) {
    throw new Error('Owned local CI config differs from the reviewed bytes')
  }
  const markerBytes = await readFile(
    path.join(workdir, '.capital-lab-owned-ci-stack.json'),
  )
  const markerText = markerBytes.toString('utf8')
  const marker = JSON.parse(markerText)
  if (markerText !== `${JSON.stringify(marker)}\n`) {
    throw new Error('Owned local CI stack marker is not canonical')
  }
  validateLocalCiMarker(marker, requested['run-id'], configBytes)
  const identityEnvironment = {
    ...process.env,
    CAPITAL_LAB_CI_RUN_ID: requested['run-id'],
  }
  const before = inspectOwnedDatabaseContainer(
    'source',
    identityEnvironment,
  ).identity
  const outcome = await runPrivate(
    'supabase',
    ['db', 'reset', '--no-seed', `--workdir=${workdir}`],
    { cwd: workspace },
  )
  const diagnostic = validateRedactedSupabaseDiagnostic(
    buildRedactedSupabaseDiagnostic(
      Buffer.concat([outcome.stdout, outcome.stderr]).toString('utf8'),
      outcome,
    ),
  )
  process.stdout.write(`${JSON.stringify(diagnostic)}\n`)
  if (
    outcome.code !== 0 ||
    outcome.signal ||
    outcome.timedOut ||
    outcome.spawnError ||
    diagnostic.exit_code !== 0
  ) {
    process.exit(1)
  }
  const after = inspectOwnedDatabaseContainer(
    'source',
    identityEnvironment,
  ).identity
  if (
    before.projectId !== after.projectId ||
    before.runtimeImageReference !== after.runtimeImageReference ||
    before.imageId !== after.imageId ||
    before.imageRepoDigest !== after.imageRepoDigest ||
    before.imageOs !== after.imageOs ||
    before.imageArchitecture !== after.imageArchitecture
  ) {
    throw new Error('Owned local CI target identity drifted during reset')
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main().catch(() => {
    process.stdout.write(
      `${JSON.stringify(buildRedactedSupabaseDiagnostic('', { code: 2, signal: null, timedOut: false, spawnError: false }))}\n`,
    )
    process.exit(2)
  })
}
