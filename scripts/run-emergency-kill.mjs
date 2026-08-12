import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, readFile, realpath } from 'node:fs/promises'
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

function emergencyGitHead(repository) {
  const git = resolveNativeExecutable('git')
  const result = spawnSync(
    git.command,
    resolvedArguments(git, ['rev-parse', 'HEAD']),
    { cwd: repository, encoding: 'utf8', shell: false, windowsHide: true },
  )
  const headSha = result.stdout?.trim()
  if (
    result.status !== 0 ||
    result.signal ||
    result.error ||
    !/^[0-9a-f]{40}$/u.test(headSha ?? '')
  ) {
    throw new Error('Emergency runner cannot derive the exact Git HEAD')
  }
  return headSha
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

async function assertNoLinkComponents(repository, filename) {
  const relative = path.relative(repository, filename)
  if (
    relative === '' ||
    relative.startsWith('..') ||
    path.isAbsolute(relative)
  ) {
    throw new Error('Emergency dependency escaped the repository')
  }
  let current = repository
  for (const component of relative.split(path.sep)) {
    current = path.join(current, component)
    if ((await lstat(current)).isSymbolicLink()) {
      throw new Error('Emergency dependency contains a symlink or junction')
    }
  }
  const resolved = await realpath(filename)
  if (path.normalize(resolved) !== path.normalize(filename)) {
    throw new Error('Emergency dependency canonical path drifted')
  }
}

async function committedFileDigest(repository, relativePath) {
  const absolute = path.join(repository, relativePath)
  await assertNoLinkComponents(repository, absolute)
  const git = resolveNativeExecutable('git')
  const tree = spawnSync(
    git.command,
    resolvedArguments(git, ['ls-tree', 'HEAD', '--', relativePath]),
    { cwd: repository, encoding: 'utf8', shell: false, windowsHide: true },
  )
  if (
    tree.status !== 0 ||
    tree.signal ||
    tree.error ||
    !/^100(?:644|755) blob [0-9a-f]{40}\t/u.test(tree.stdout)
  ) {
    throw new Error('Emergency dependency is not a committed regular file')
  }
  const blob = spawnSync(
    git.command,
    resolvedArguments(git, ['show', `HEAD:${relativePath}`]),
    { cwd: repository, encoding: 'buffer', shell: false, windowsHide: true },
  )
  if (blob.status !== 0 || blob.signal || blob.error) {
    throw new Error('Emergency dependency Git blob is unavailable')
  }
  const committedDigest = digest(blob.stdout)
  if (committedDigest !== digest(await readFile(absolute))) {
    throw new Error('Emergency runner dependency differs from committed HEAD')
  }
  return committedDigest
}

export async function emergencyDependencyClosure(repository) {
  const pending = ['scripts/run-emergency-kill.mjs']
  const discovered = new Set()
  while (pending.length > 0) {
    const relativePath = pending.pop()
    if (discovered.has(relativePath)) continue
    discovered.add(relativePath)
    const source = await readFile(path.join(repository, relativePath), 'utf8')
    const imports = source.matchAll(
      /(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"](\.[^'"]+)['"]/gu,
    )
    for (const match of imports) {
      const resolved = path
        .relative(
          repository,
          path.resolve(
            path.dirname(path.join(repository, relativePath)),
            match[1],
          ),
        )
        .replaceAll(path.sep, '/')
      pending.push(path.extname(resolved) ? resolved : `${resolved}.mjs`)
    }
  }
  discovered.add('scripts/lib/canonical-repository-bytes.mjs')
  discovered.add('package.json')
  discovered.add('supabase/activation/emergency-kill.sql')
  return [...discovered].sort()
}

export async function verifyEmergencyDependencies(repository) {
  const headSha = emergencyGitHead(repository)
  const closure = await emergencyDependencyClosure(repository)
  const closureDigests = []
  for (const relativePath of closure) {
    closureDigests.push(
      `${relativePath}\u001f${await committedFileDigest(repository, relativePath)}`,
    )
  }
  return {
    closure,
    dependencyClosureSha256: digest(closureDigests.join('\n')),
    headSha,
  }
}

async function spawnBounded(command, args, options) {
  return new Promise((resolve) => {
    let settled = false
    let timedOut = false
    const child = spawn(command, args, {
      ...options,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
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
  const dependencyEvidence = await verifyEmergencyDependencies(repository)
  const scriptPath = await realpath(
    path.join(repository, 'supabase', 'activation', 'emergency-kill.sql'),
  )
  const node = resolveNativeExecutable('node')
  if ((await realpath(process.execPath)) !== node.command) {
    throw new Error('Emergency runner Node executable identity drifted')
  }
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
      gitHeadSha: dependencyEvidence.headSha,
      dependencyClosureCount: dependencyEvidence.closure.length,
      dependencyClosureSha256: dependencyEvidence.dependencyClosureSha256,
      runtimeExecutableVerified: true,
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
