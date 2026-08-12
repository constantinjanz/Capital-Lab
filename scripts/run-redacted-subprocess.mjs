import { spawn } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  resolvedArguments,
  resolveNativeExecutable,
} from './lib/safe-process.mjs'

const PROCESS_TIMEOUT_MS = 10 * 60 * 1000
const SAFE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/u

const SENSITIVE = [
  /\bBearer\s+[^\s,;]+/giu,
  /\bAuthorization\s*[:=]\s*[^\r\n]+/giu,
  /\b(?:postgres(?:ql)?|https?):\/\/[^\s/@:]+:[^\s/@]+@[^\s]+/giu,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu,
  /\b(?:sbp|sb_secret|sb_publishable|vercel)_[A-Za-z0-9_-]{8,}\b/gu,
  /\b(?:password|passwd|token|secret|api[_-]?key|cookie)\s*[:=]\s*[^\s,;]+/giu,
]

function redactDecoded(value) {
  return SENSITIVE.reduce(
    (redacted, pattern) => redacted.replace(pattern, '[redacted]'),
    value,
  )
}

export function redactSensitiveText(value) {
  const source = String(value)
  let redacted = redactDecoded(source)
  try {
    const decoded = decodeURIComponent(source)
    if (decoded !== source && redactDecoded(decoded) !== decoded) {
      redacted = '[redacted-url-encoded-sensitive-output]'
    }
  } catch {
    // Malformed percent encoding is not decoded or echoed by the runner.
  }
  return redacted
}

function parseArguments(argv) {
  const separator = argv.indexOf('--')
  if (separator !== 1 || !argv[0]?.startsWith('--id=')) {
    throw new Error(
      'Required: --id=<safe-id> -- supabase start [--workdir=<path>]',
    )
  }
  const id = argv[0].slice('--id='.length)
  const command = argv[separator + 1]
  const args = argv.slice(separator + 2)
  if (!SAFE_ID.test(id) || command !== 'supabase' || args[0] !== 'start') {
    throw new Error('Redacted subprocess is outside the exact allowlist')
  }
  if (
    args.length > 2 ||
    (args.length === 2 && !args[1].startsWith('--workdir='))
  ) {
    throw new Error('Supabase start arguments are outside the exact allowlist')
  }
  return { args, command, id }
}

async function canonicalizeArguments(args) {
  if (args.length === 1) return args
  const requested = args[1].slice('--workdir='.length)
  const resolved = await realpath(path.resolve(requested))
  return ['start', `--workdir=${resolved}`]
}

export async function runRedacted(argv = process.argv.slice(2)) {
  const requested = parseArguments(argv)
  const executable = resolveNativeExecutable(requested.command)
  const args = await canonicalizeArguments(requested.args)
  const outcome = await new Promise((resolve) => {
    let settled = false
    let timedOut = false
    const child = spawn(
      executable.command,
      resolvedArguments(executable, args),
      {
        env: process.env,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    // Consume both streams without ever forwarding credential-bearing output.
    child.stdout.on('data', () => {})
    child.stderr.on('data', () => {})
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, PROCESS_TIMEOUT_MS)
    child.once('error', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code: null, signal: null, timedOut, spawnError: true })
    })
    child.once('exit', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, signal, timedOut, spawnError: false })
    })
  })
  const success =
    outcome.code === 0 &&
    !outcome.signal &&
    !outcome.timedOut &&
    !outcome.spawnError
  const evidence = {
    status: success
      ? 'redacted_subprocess_ready'
      : 'redacted_subprocess_failed',
    operation: requested.id,
    outputForwarded: false,
    timedOut: outcome.timedOut,
    signal: outcome.signal,
    exitCode: outcome.code,
  }
  process.stdout.write(`${JSON.stringify(evidence)}\n`)
  return success ? 0 : 1
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await runRedacted()
    .then((code) => process.exit(code))
    .catch(() => {
      process.stderr.write('Redacted subprocess failed closed before launch.\n')
      process.exit(2)
    })
}
