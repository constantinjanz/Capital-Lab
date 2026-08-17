import { spawn, spawnSync } from 'node:child_process'

import {
  LOCAL_CI_DATABASE_PORT,
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
const COMMIT_SHA = /^[0-9a-f]{40}$/u

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
      container: `supabase_db_capital-lab-reference-${runId}`,
      port,
      projectId: `capital-lab-reference-${runId}`,
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

export async function runOwnedPostgresTool(
  role,
  tool,
  args,
  input,
  { binary = false, timeoutMs = PROCESS_TIMEOUT_MS } = {},
) {
  if (!['pg_dump', 'pg_dumpall', 'psql'].includes(tool)) {
    throw new Error('Owned local PostgreSQL tool is outside the allowlist')
  }
  const target = inspectOwnedDatabaseContainer(role)
  const executable = resolveNativeExecutable('docker')
  const versionOnly = args.length === 1 && args[0] === '--version'
  return new Promise((resolve, reject) => {
    let stdout = Buffer.alloc(0)
    let stderr = Buffer.alloc(0)
    let settled = false
    let timedOut = false
    let forceTimer
    const append = (current, chunk) =>
      Buffer.concat([current, Buffer.from(chunk)]).subarray(-32 * 1024 * 1024)
    const child = spawn(
      executable.command,
      resolvedArguments(executable, [
        'exec',
        '--interactive',
        target.container,
        tool,
        ...(versionOnly ? [] : ['--username=postgres', '--dbname=postgres']),
        ...args,
      ]),
      {
        env: process.env,
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )
    child.stdout.on('data', (chunk) => (stdout = append(stdout, chunk)))
    child.stderr.on('data', (chunk) => (stderr = append(stderr, chunk)))
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
      reject(new Error('Owned local PostgreSQL tool spawn failed'))
    })
    child.once('close', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(forceTimer)
      if (code !== 0 || signal || timedOut) {
        reject(new Error('Owned local PostgreSQL tool failed closed'))
      } else {
        resolve({
          stdout: binary ? stdout : stdout.toString('utf8'),
          stderr: stderr.toString('utf8'),
        })
      }
    })
    child.stdin.end(input)
  })
}

export async function ownedPsql(role, sql, capture = true) {
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
  )
  return capture ? result.stdout.trim() : ''
}
