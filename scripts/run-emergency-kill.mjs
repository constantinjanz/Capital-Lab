import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  resolvedArguments,
  resolveNativeExecutable,
} from './lib/safe-process.mjs'

const PROJECT_REF = 'qrnuyibntcxwffrxmrvn'
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const PROCESS_TIMEOUT_MS = 20_000

function option(name) {
  const prefix = `--${name}=`
  const values = process.argv.filter((argument) => argument.startsWith(prefix))
  return values.length === 1 ? values[0].slice(prefix.length) : undefined
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

export function validateEmergencyTarget(databaseUrlValue) {
  let parsed
  try {
    parsed = new URL(databaseUrlValue)
  } catch {
    throw new Error('Emergency database target is invalid')
  }
  const parameters = [...parsed.searchParams.entries()]
  const username = decodeURIComponent(parsed.username)
  const direct =
    parsed.hostname === `db.${PROJECT_REF}.supabase.co` &&
    username === 'postgres'
  const sessionPooler =
    /^[a-z0-9-]+\.pooler\.supabase\.com$/u.test(parsed.hostname) &&
    username === `postgres.${PROJECT_REF}`
  if (
    parsed.protocol !== 'postgresql:' ||
    parsed.hash ||
    !parsed.password ||
    parsed.pathname !== '/postgres' ||
    (parsed.port || '5432') !== '5432' ||
    parameters.length !== 1 ||
    parameters[0][0] !== 'sslmode' ||
    parameters[0][1] !== 'verify-full' ||
    (!direct && !sessionPooler)
  ) {
    throw new Error(
      'Emergency target is not the exact TLS-verified Supabase boundary',
    )
  }
  return direct ? 'direct' : 'session_pooler'
}

export function classifyEmergencyProcessResult(result) {
  const unknown = Boolean(
    result?.timedOut ||
    result?.error ||
    result?.signal ||
    result?.code === null ||
    result?.code === undefined,
  )
  return {
    outcome: unknown ? 'unknown' : result.code === 0 ? 'completed' : 'failed',
    exitCode: result?.code ?? null,
    signal: result?.signal ?? null,
    timedOut: Boolean(result?.timedOut),
  }
}

export function validateEmergencyConfirmation(campaignId, confirmation) {
  if (!UUID.test(campaignId ?? '')) throw new Error('Campaign UUID is invalid')
  const expected = `EMERGENCY KILL CAPITAL LAB CAMPAIGN ${campaignId}`
  if (confirmation !== expected)
    throw new Error('Emergency confirmation phrase is invalid')
  return expected
}

async function committedFileMatches(repository, relativePath) {
  const git = resolveNativeExecutable('git')
  const result = spawnSync(
    git.command,
    resolvedArguments(git, ['show', `HEAD:${relativePath}`]),
    { cwd: repository, encoding: 'buffer', shell: false, windowsHide: true },
  )
  if (result.status !== 0 || result.signal || result.error) return false
  return (
    digest(result.stdout) ===
    digest(await readFile(path.join(repository, relativePath)))
  )
}

async function spawnBounded(command, args, options) {
  return new Promise((resolve) => {
    let settled = false
    let timedOut = false
    const child = spawn(command, args, {
      ...options,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'inherit', 'pipe'],
    })
    child.stderr.on('data', () => {})
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, PROCESS_TIMEOUT_MS)
    child.once('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code: null, signal: null, timedOut, error })
    })
    child.once('exit', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, signal, timedOut, error: null })
    })
  })
}

async function main() {
  const campaignId = option('campaign-id')
  const confirmation = option('confirm')
  if (process.argv.length !== 4)
    throw new Error('Unknown or duplicate emergency arguments are forbidden')
  validateEmergencyConfirmation(campaignId, confirmation)
  const databaseUrl = process.env.CAPITAL_LAB_DATABASE_URL
  if (!databaseUrl)
    throw new Error('CAPITAL_LAB_DATABASE_URL is required and never printed')
  const connectionMode = validateEmergencyTarget(databaseUrl)
  const repository = await realpath(process.cwd())
  for (const relativePath of [
    'scripts/run-emergency-kill.mjs',
    'scripts/lib/safe-process.mjs',
    'supabase/activation/emergency-kill.sql',
  ]) {
    if (!(await committedFileMatches(repository, relativePath))) {
      throw new Error('Emergency runner or SQL differs from committed HEAD')
    }
  }
  const scriptPath = await realpath(
    path.join(repository, 'supabase', 'activation', 'emergency-kill.sql'),
  )
  const psql = resolveNativeExecutable('psql')
  const result = await spawnBounded(
    psql.command,
    resolvedArguments(psql, [
      '-X',
      '--no-psqlrc',
      '--set',
      'ON_ERROR_STOP=1',
      '--set',
      `campaign_id=${campaignId}`,
      '--file',
      scriptPath,
    ]),
    {
      cwd: repository,
      env: {
        ...process.env,
        PGDATABASE: databaseUrl,
        PGCONNECT_TIMEOUT: '5',
        PGOPTIONS: '-c statement_timeout=15000 -c lock_timeout=3000',
      },
    },
  )
  const processEvidence = classifyEmergencyProcessResult(result)
  process.stdout.write(
    `${JSON.stringify({
      schemaVersion: 1,
      operation: 'emergency_kill',
      campaignId,
      projectRef: PROJECT_REF,
      connectionMode,
      ...processEvidence,
    })}\n`,
  )
  process.exit(processEvidence.outcome === 'unknown' ? 3 : (result.code ?? 1))
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : 'Emergency kill failed closed',
    )
    process.exit(2)
  })
}
