import { spawn, spawnSync } from 'node:child_process'
import { constants as osConstants } from 'node:os'

import {
  LOCAL_CI_DATABASE_PORT,
  canonicalReferenceProjectId,
  localCiProjectId,
  validateLocalCiContainerInspection,
  validateOwnedLocalDatabaseContainerBinding,
  validateOwnedLocalDatabaseIdentity,
} from './owned-local-ci-stack.mjs'
import {
  restoreProjectId,
  validateRestoreContainerInspection,
} from './local-supabase-target-proof.mjs'
import {
  diagnoseOwnedLocalDatabaseContainer,
  diagnoseOwnedLocalDatabaseImage,
  emitLocalContainerIdentityRejection,
  localContainerInspectFailureDiagnostic,
  LocalContainerImageIdentityRejection,
} from './local-container-identity-diagnostic.mjs'
import { resolvedArguments, resolveNativeExecutable } from './safe-process.mjs'

const PROCESS_TIMEOUT_MS = 10 * 60 * 1000
const MAX_STDOUT_BYTES = 32 * 1024 * 1024
const MAX_PSQL_STDERR_BYTES = 64 * 1024
const COMMIT_SHA = /^[0-9a-f]{40}$/u
const SQLSTATE_REPORT = /^(?:ERROR|FATAL|PANIC):  ([0-9A-Z]{5})$/u
const SQLSTATE_REPORT_PREFIX = /^(?:ERROR|FATAL|PANIC):  /u
const CLIENT_STAGE_MARKER_PREFIX =
  /^CAPITAL_LAB_CLIENT_STAGE_MARKER:[A-Z][A-Z0-9_]{0,31}:$/u
const CLIENT_STAGE_MARKER_LINE = /^[A-Za-z0-9_.:|-]+$/u
const VALID_SIGNALS = new Set(Object.keys(osConstants.signals))
const ownedLocalPostgresToolFailures = new WeakSet()

/**
 * @typedef {object} OwnedPostgresToolOptions
 * @property {boolean} [binary]
 * @property {{prefix: string, markers: readonly string[]}} [clientStageMarkerPlan]
 * @property {number} [timeoutMs]
 */

class OwnedLocalPostgresToolFailure extends Error {
  constructor({
    exitCode,
    lastClientStageMarkerIndex,
    signal,
    sqlstate,
    timedOut,
  }) {
    super('Owned local PostgreSQL tool failed closed')
    delete this.stack
    Object.defineProperties(this, {
      exitCode: { enumerable: true, value: exitCode },
      lastClientStageMarkerIndex: {
        enumerable: true,
        value: lastClientStageMarkerIndex,
      },
      signal: { enumerable: true, value: signal },
      sqlstate: { enumerable: true, value: sqlstate },
      timedOut: { enumerable: true, value: timedOut },
    })
    ownedLocalPostgresToolFailures.add(this)
    Object.freeze(this)
  }
}

export function isOwnedLocalPostgresToolFailure(value) {
  return ownedLocalPostgresToolFailures.has(value)
}

function validatedExitCode(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

function validatedSignal(value) {
  return typeof value === 'string' && VALID_SIGNALS.has(value) ? value : null
}

function validateClientStageMarkerPlan(value) {
  if (value === undefined) return null
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getOwnPropertySymbols(value).length !== 0 ||
    Object.keys(value).sort().join(',') !== 'markers,prefix' ||
    typeof value.prefix !== 'string' ||
    !CLIENT_STAGE_MARKER_PREFIX.test(value.prefix) ||
    !Array.isArray(value.markers) ||
    value.markers.length === 0 ||
    value.markers.length > 128
  ) {
    return undefined
  }
  const markers = [...value.markers]
  if (
    markers.some(
      (marker) =>
        typeof marker !== 'string' ||
        marker.length <= value.prefix.length ||
        marker.length > 256 ||
        !marker.startsWith(value.prefix) ||
        !CLIENT_STAGE_MARKER_LINE.test(marker),
    ) ||
    new Set(markers).size !== markers.length
  ) {
    return undefined
  }
  return Object.freeze({
    markers: Object.freeze(markers),
    prefix: value.prefix,
  })
}

function appendBounded(current, chunk, limit, wasTruncated = false) {
  const incoming = Buffer.from(chunk)
  if (incoming.length >= limit) {
    return {
      buffer: Buffer.from(incoming.subarray(incoming.length - limit)),
      truncated: true,
    }
  }
  const combined = Buffer.concat([current, incoming])
  if (combined.length <= limit) {
    return { buffer: combined, truncated: wasTruncated }
  }
  return {
    buffer: Buffer.from(combined.subarray(combined.length - limit)),
    truncated: true,
  }
}

function stderrLines(stderr) {
  return stderr.split(/\r?\n/u)
}

function deriveSqlstate(stderr, stderrTruncated) {
  if (stderrTruncated) return null
  const candidates = stderrLines(stderr).filter((line) =>
    SQLSTATE_REPORT_PREFIX.test(line),
  )
  if (candidates.length !== 1) return null
  return SQLSTATE_REPORT.exec(candidates[0])?.[1] ?? null
}

function deriveLastClientStageMarkerIndex(stderr, stderrTruncated, markerPlan) {
  if (!markerPlan || stderrTruncated) return null
  const observed = stderrLines(stderr).filter((line) =>
    line.startsWith(markerPlan.prefix),
  )
  if (observed.length === 0 || observed.length > markerPlan.markers.length) {
    return null
  }
  for (let index = 0; index < observed.length; index += 1) {
    if (observed[index] !== markerPlan.markers[index]) return null
  }
  return observed.length - 1
}

function removeClientStageMarkerLines(stderr, markerPlan) {
  if (!markerPlan) return stderr
  return stderr
    .split('\n')
    .filter((line) => !line.replace(/\r$/u, '').startsWith(markerPlan.prefix))
    .join('\n')
}

function sanitizedPsqlFailure({
  code,
  markerPlan,
  signal,
  stderr,
  stderrTruncated,
  timedOut,
}) {
  const rawExitCode = validatedExitCode(code)
  const safeSignal = validatedSignal(signal)
  const exitCode = signal === null && !timedOut ? rawExitCode : null
  const normalNonzeroExit =
    exitCode !== null && exitCode !== 0 && signal === null && !timedOut
  return new OwnedLocalPostgresToolFailure({
    exitCode,
    lastClientStageMarkerIndex: deriveLastClientStageMarkerIndex(
      stderr,
      stderrTruncated,
      markerPlan,
    ),
    signal: safeSignal,
    sqlstate: normalNonzeroExit
      ? deriveSqlstate(stderr, stderrTruncated)
      : null,
    timedOut,
  })
}

function rejectLocalContainerIdentity(role, env, diagnostic) {
  const error = new LocalContainerImageIdentityRejection(role, diagnostic)
  if (COMMIT_SHA.test(env.CAPITAL_LAB_CI_COMMIT_SHA ?? '')) {
    try {
      emitLocalContainerIdentityRejection(error, env.CAPITAL_LAB_CI_COMMIT_SHA)
    } catch {
      throw new Error(
        'Local container identity diagnostic persistence failed closed',
      )
    }
  }
  throw error
}

export function ownedDatabaseContainer(role, env = process.env) {
  if (role === 'source') {
    const runId = env.CAPITAL_LAB_CI_RUN_ID
    return {
      container: `supabase_db_${localCiProjectId(runId)}`,
      port: LOCAL_CI_DATABASE_PORT,
      projectId: localCiProjectId(runId),
      runId,
    }
  }
  if (role === 'restore') {
    const runId = env.CAPITAL_LAB_RESTORE_RUN_ID
    return {
      container: `supabase_db_${restoreProjectId(runId)}`,
      port: '55322',
      projectId: restoreProjectId(runId),
      runId,
    }
  }
  if (role === 'reference' || role === 'peer_reference') {
    const prefix =
      role === 'reference'
        ? 'CAPITAL_LAB_REFERENCE'
        : 'CAPITAL_LAB_PEER_REFERENCE'
    const runId = env[`${prefix}_RUN_ID`]
    const port = env[`${prefix}_DATABASE_PORT`]
    if (
      !/^run-(?:pre|post)-(?:a|b)-[a-z0-9][a-z0-9-]{2,28}$/u.test(
        runId ?? '',
      ) ||
      !/^5[6-9][0-9]{3}$/u.test(port ?? '')
    ) {
      throw new Error('Local Reference database identity is invalid')
    }
    return {
      container: `supabase_db_${canonicalReferenceProjectId(runId)}`,
      port,
      projectId: canonicalReferenceProjectId(runId),
      runId,
    }
  }
  throw new Error('Local database container role is invalid')
}

export function inspectOwnedDatabaseContainer(role, env = process.env) {
  const target = ownedDatabaseContainer(role, env)
  let executable
  try {
    executable = resolveNativeExecutable('docker')
  } catch {
    rejectLocalContainerIdentity(
      role,
      env,
      localContainerInspectFailureDiagnostic(
        'container_inspect',
        'container_inspect_unavailable',
        target,
      ),
    )
  }
  let result
  try {
    result = spawnSync(
      executable.command,
      resolvedArguments(executable, ['inspect', target.container]),
      { encoding: 'utf8', shell: false, timeout: 30_000, windowsHide: true },
    )
  } catch {
    rejectLocalContainerIdentity(
      role,
      env,
      localContainerInspectFailureDiagnostic(
        'container_inspect',
        'container_inspect_unavailable',
        target,
      ),
    )
  }
  if (result.status !== 0 || result.signal || result.error) {
    rejectLocalContainerIdentity(
      role,
      env,
      localContainerInspectFailureDiagnostic(
        'container_inspect',
        'container_inspect_unavailable',
        target,
      ),
    )
  }
  let parsed
  try {
    parsed = JSON.parse(result.stdout)
  } catch {
    rejectLocalContainerIdentity(
      role,
      env,
      localContainerInspectFailureDiagnostic(
        'container_shape',
        'container_json',
        target,
      ),
    )
  }
  const containerDiagnostic = diagnoseOwnedLocalDatabaseContainer(
    parsed,
    target,
  )
  if (containerDiagnostic) {
    rejectLocalContainerIdentity(role, env, containerDiagnostic)
  }
  const containerBinding = validateOwnedLocalDatabaseContainerBinding(
    parsed[0],
    target,
  )
  let imageResult
  try {
    imageResult = spawnSync(
      executable.command,
      resolvedArguments(executable, [
        'image',
        'inspect',
        containerBinding.containerImageId,
      ]),
      { encoding: 'utf8', shell: false, timeout: 30_000, windowsHide: true },
    )
  } catch {
    rejectLocalContainerIdentity(
      role,
      env,
      localContainerInspectFailureDiagnostic(
        'image_inspect',
        'image_inspect_unavailable',
        target,
        parsed,
      ),
    )
  }
  if (imageResult.status !== 0 || imageResult.signal || imageResult.error) {
    rejectLocalContainerIdentity(
      role,
      env,
      localContainerInspectFailureDiagnostic(
        'image_inspect',
        'image_inspect_unavailable',
        target,
        parsed,
      ),
    )
  }
  let imageParsed
  try {
    imageParsed = JSON.parse(imageResult.stdout)
  } catch {
    rejectLocalContainerIdentity(
      role,
      env,
      localContainerInspectFailureDiagnostic(
        'image_shape',
        'image_json',
        target,
        parsed,
      ),
    )
  }
  const imageDiagnostic = diagnoseOwnedLocalDatabaseImage(
    parsed[0],
    imageParsed,
    target,
  )
  if (imageDiagnostic) {
    rejectLocalContainerIdentity(role, env, imageDiagnostic)
  }
  let identity
  if (role === 'source') {
    identity = validateLocalCiContainerInspection(
      parsed[0],
      imageParsed,
      target.runId,
    )
  } else if (role === 'restore') {
    identity = validateRestoreContainerInspection(
      parsed[0],
      imageParsed,
      target.runId,
    )
  } else {
    identity = validateOwnedLocalDatabaseIdentity(
      parsed[0],
      imageParsed,
      target,
    )
  }
  return {
    ...target,
    identity,
    imageInspection: imageParsed[0],
    inspection: parsed[0],
  }
}

/**
 * @param {any} role
 * @param {any} tool
 * @param {any} args
 * @param {any} input
 * @param {OwnedPostgresToolOptions} [options]
 */
export async function runOwnedPostgresTool(
  role,
  tool,
  args,
  input,
  options = {},
) {
  const {
    binary = false,
    clientStageMarkerPlan,
    timeoutMs = PROCESS_TIMEOUT_MS,
  } = options
  if (!['pg_dump', 'pg_dumpall', 'psql'].includes(tool)) {
    throw new Error('Owned local PostgreSQL tool is outside the allowlist')
  }
  const target = inspectOwnedDatabaseContainer(role)
  const executable = resolveNativeExecutable('docker')
  const versionOnly = args.length === 1 && args[0] === '--version'
  let markerPlan
  try {
    markerPlan = validateClientStageMarkerPlan(clientStageMarkerPlan)
  } catch {
    markerPlan = undefined
  }
  if (markerPlan === undefined || (markerPlan && tool !== 'psql')) {
    throw new OwnedLocalPostgresToolFailure({
      exitCode: null,
      lastClientStageMarkerIndex: null,
      signal: null,
      sqlstate: null,
      timedOut: false,
    })
  }
  return new Promise((resolve, reject) => {
    let stdout = Buffer.alloc(0)
    let stderr = Buffer.alloc(0)
    let stderrTruncated = false
    let settled = false
    let timedOut = false
    let forceTimer
    const processArgs = resolvedArguments(executable, [
      'exec',
      '--interactive',
      target.container,
      tool,
      ...(versionOnly ? [] : ['--username=postgres', '--dbname=postgres']),
      ...args,
      ...(tool === 'psql' && !versionOnly ? ['--set=VERBOSITY=sqlstate'] : []),
    ])
    let child
    try {
      child = spawn(executable.command, processArgs, {
        env: process.env,
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch {
      reject(
        tool === 'psql'
          ? sanitizedPsqlFailure({
              code: null,
              markerPlan,
              signal: null,
              stderr: '',
              stderrTruncated: false,
              timedOut: false,
            })
          : new Error('Owned local PostgreSQL tool spawn failed'),
      )
      return
    }
    child.stdout.on('data', (chunk) => {
      stdout = appendBounded(stdout, chunk, MAX_STDOUT_BYTES).buffer
    })
    child.stderr.on('data', (chunk) => {
      const appended = appendBounded(
        stderr,
        chunk,
        tool === 'psql' ? MAX_PSQL_STDERR_BYTES : MAX_STDOUT_BYTES,
        stderrTruncated,
      )
      stderr = appended.buffer
      stderrTruncated = appended.truncated
    })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      forceTimer = setTimeout(() => child.kill('SIGKILL'), 5_000)
    }, timeoutMs)
    child.once('error', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(forceTimer)
      stdout.fill(0)
      stderr.fill(0)
      stdout = Buffer.alloc(0)
      stderr = Buffer.alloc(0)
      reject(
        tool === 'psql'
          ? sanitizedPsqlFailure({
              code: null,
              markerPlan,
              signal: null,
              stderr: '',
              stderrTruncated: false,
              timedOut,
            })
          : new Error('Owned local PostgreSQL tool spawn failed'),
      )
    })
    child.once('close', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(forceTimer)
      if (code !== 0 || signal || timedOut) {
        if (tool === 'psql') {
          let stderrText = stderr.toString('utf8')
          const failure = sanitizedPsqlFailure({
            code,
            markerPlan,
            signal,
            stderr: stderrText,
            stderrTruncated,
            timedOut,
          })
          stderrText = ''
          stdout.fill(0)
          stderr.fill(0)
          stdout = Buffer.alloc(0)
          stderr = Buffer.alloc(0)
          reject(failure)
        } else {
          stdout.fill(0)
          stderr.fill(0)
          stdout = Buffer.alloc(0)
          stderr = Buffer.alloc(0)
          reject(new Error('Owned local PostgreSQL tool failed closed'))
        }
      } else {
        const stdoutValue = binary ? stdout : stdout.toString('utf8')
        const stderrValue = removeClientStageMarkerLines(
          stderr.toString('utf8'),
          markerPlan,
        )
        if (!binary) stdout.fill(0)
        stderr.fill(0)
        if (!binary) stdout = Buffer.alloc(0)
        stderr = Buffer.alloc(0)
        resolve({
          stdout: stdoutValue,
          stderr: stderrValue,
        })
      }
    })
    try {
      child.stdin.end(input)
    } catch {
      try {
        child.kill('SIGTERM')
      } catch {
        // The registered fixed spawn-failure boundary remains authoritative.
      }
      child.emit('error')
    }
  })
}

export async function ownedPsql(role, sql, capture = true, options = {}) {
  const result = await runOwnedPostgresTool(
    role,
    'psql',
    [
      '--no-psqlrc',
      '--quiet',
      '--set=ON_ERROR_STOP=1',
      ...(capture ? ['--tuples-only', '--no-align'] : []),
    ],
    sql,
    options,
  )
  return capture ? result.stdout.trim() : ''
}
