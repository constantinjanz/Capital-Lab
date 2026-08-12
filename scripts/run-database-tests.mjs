import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  resolvedArguments,
  resolveNativeExecutable,
} from './lib/safe-process.mjs'

const PROBE_TIMEOUT_MS = 20_000
const DATABASE_TIMEOUT_MS = 15 * 60_000

export function classifyDatabaseProcessResult(result) {
  if (
    result?.error ||
    result?.signal ||
    result?.status === null ||
    result?.status === undefined
  ) {
    return { exitCode: 3, outcome: 'unknown' }
  }
  return {
    exitCode: result.status,
    outcome: result.status === 0 ? 'completed' : 'failed',
  }
}

function runNative(resolved, args, timeout, stdio, spawn) {
  return classifyDatabaseProcessResult(
    spawn(resolved.command, resolvedArguments(resolved, args), {
      env: {
        ...process.env,
        PGCONNECT_TIMEOUT: '10',
        PGOPTIONS: '-c statement_timeout=300000 -c lock_timeout=10000',
      },
      shell: false,
      stdio,
      timeout,
      windowsHide: true,
    }),
  )
}

export function runDatabaseTests({
  resolveExecutable = resolveNativeExecutable,
  spawn = spawnSync,
} = {}) {
  let docker
  let supabase
  try {
    docker = resolveExecutable('docker')
  } catch {
    console.error('Database tests require the native Docker executable.')
    return 2
  }
  const dockerProbe = runNative(
    docker,
    ['version', '--format', '{{.Server.Version}}'],
    PROBE_TIMEOUT_MS,
    'ignore',
    spawn,
  )
  if (dockerProbe.outcome !== 'completed') {
    console.error('Database tests require a reachable Docker daemon.')
    return dockerProbe.outcome === 'unknown' ? 3 : 2
  }

  try {
    supabase = resolveExecutable('supabase')
  } catch {
    console.error('Database tests require the native Supabase CLI executable.')
    return 2
  }
  const cliProbe = runNative(
    supabase,
    ['--version'],
    PROBE_TIMEOUT_MS,
    'ignore',
    spawn,
  )
  if (cliProbe.outcome !== 'completed') {
    console.error('The native Supabase CLI probe failed closed.')
    return cliProbe.outcome === 'unknown' ? 3 : 2
  }

  const reset = runNative(
    supabase,
    ['db', 'reset'],
    DATABASE_TIMEOUT_MS,
    'inherit',
    spawn,
  )
  if (reset.outcome !== 'completed') return reset.exitCode || 1

  const tests = runNative(
    supabase,
    ['test', 'db'],
    DATABASE_TIMEOUT_MS,
    'inherit',
    spawn,
  )
  return tests.exitCode || 0
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  process.exit(runDatabaseTests())
}
