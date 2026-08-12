import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { canonicalRepositoryTextBytes } from './lib/canonical-repository-bytes.mjs'
import { verifiedExternalFile } from './lib/safe-artifact-path.mjs'
import {
  resolvedArguments,
  resolveNativeExecutable,
} from './lib/safe-process.mjs'
import {
  validateDeploymentProof,
  validateProjectIdentityContract,
} from './vercel-deployment-proof.mjs'

const PROJECT_REF = 'qrnuyibntcxwffrxmrvn'
const SHA256 = /^[0-9a-f]{64}$/
const GIT_SHA = /^[0-9a-f]{40}$/
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]{20,64}$/
const CONFIG_VERSION = /^[a-z0-9][a-z0-9._-]{0,127}$/
const PHASE = /^[a-z][a-z0-9-]{1,63}$/
const PROCESS_TIMEOUT_MS = 180_000
const DEPLOYMENT_PROOF_ROLES = new Map([
  ['auth-endpoint-verify', 'auth_disabled'],
  ['runtime-deployment-verify', 'no_ai_runtime_enabled'],
])

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function fail(message, exitCode = 2) {
  console.error(message)
  process.exit(exitCode)
}

function option(name) {
  const prefix = `--${name}=`
  const values = process.argv.filter((argument) => argument.startsWith(prefix))
  if (values.length !== 1) return undefined
  return values[0].slice(prefix.length)
}

function samePath(left, right) {
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child)
  return (
    relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
  )
}

function requiredText(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error(`Campaign manifest has an invalid ${label}`)
  }
  return value
}

function exactKeys(value, expected, label) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify([...expected].sort())
  ) {
    throw new Error(`Campaign manifest has invalid ${label} fields`)
  }
}

function rejectSensitiveKeys(value, pathName = 'manifest') {
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (/secret|password|authorization|credential|token/i.test(key)) {
      throw new Error(
        `Campaign manifest forbids sensitive field ${pathName}.${key}`,
      )
    }
    rejectSensitiveKeys(child, `${pathName}.${key}`)
  }
}

function hasExplicitPort(rawUrl) {
  const schemeEnd = rawUrl.indexOf('//')
  if (schemeEnd < 0) return false
  const authority = rawUrl.slice(schemeEnd + 2).split(/[/?#]/, 1)[0]
  const hostPort = authority.slice(authority.lastIndexOf('@') + 1)
  return hostPort.includes(':')
}

export function validateSchedulerIdentity(manifest, projectIdentity) {
  validateProjectIdentityContract(projectIdentity)
  const origin = new URL(manifest.production_origin)
  if (
    hasExplicitPort(manifest.production_origin) ||
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.port ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    origin.hostname !== manifest.production_host ||
    !projectIdentity.allowedProductionHosts.includes(origin.hostname) ||
    !/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(origin.hostname)
  ) {
    throw new Error('Campaign Production origin is not canonical')
  }
  if (manifest.scheduler_path !== '/api/internal/scheduler') {
    throw new Error('Campaign scheduler path is not allowlisted')
  }
  const schedulerUrl = new URL(manifest.scheduler_url)
  if (
    hasExplicitPort(manifest.scheduler_url) ||
    schedulerUrl.origin !== origin.origin ||
    schedulerUrl.pathname !== manifest.scheduler_path ||
    schedulerUrl.username ||
    schedulerUrl.password ||
    schedulerUrl.port ||
    schedulerUrl.search ||
    schedulerUrl.hash ||
    schedulerUrl.toString() !== `${origin.origin}${manifest.scheduler_path}`
  ) {
    throw new Error('Campaign scheduler URL is not the exact reviewed URL')
  }
  if (manifest.vercel_environment !== 'production') {
    throw new Error('Only the Production environment can be prepared')
  }
  requiredText(
    manifest.production_deployment_id,
    DEPLOYMENT_ID,
    'Production deployment ID',
  )
  requiredText(manifest.vercel_commit_sha, GIT_SHA, 'Vercel commit SHA')
  if (
    manifest.vercel_team_id !== projectIdentity.vercelTeamId ||
    manifest.vercel_project_id !== projectIdentity.vercelProjectId ||
    manifest.supabase_project_ref !== projectIdentity.supabaseProjectRef ||
    manifest.scheduler_path !== projectIdentity.schedulerPath
  ) {
    throw new Error('Campaign project identity is not the reviewed contract')
  }
}

export function validateDatabaseTarget(databaseUrlValue, target) {
  let parsed
  try {
    parsed = new URL(databaseUrlValue)
  } catch {
    throw new Error('Activation database URL is invalid')
  }
  if (parsed.protocol !== 'postgresql:' || parsed.hash) {
    throw new Error('Activation database URL must use postgresql')
  }
  const parameters = [...parsed.searchParams.entries()]
  if (
    parameters.length !== 1 ||
    parameters[0][0] !== 'sslmode' ||
    parameters[0][1] !== 'verify-full'
  ) {
    throw new Error('Hosted activation requires sslmode=verify-full only')
  }
  const username = decodeURIComponent(parsed.username)
  const database = parsed.pathname.replace(/^\//, '')
  const port = parsed.port || '5432'
  if (
    parsed.hostname !== target.hostname ||
    username !== target.username ||
    database !== target.database ||
    port !== String(target.port) ||
    target.project_ref !== PROJECT_REF ||
    target.sslmode !== 'verify-full'
  ) {
    throw new Error('Activation database target differs from the frozen target')
  }
  if (
    target.connection_mode === 'direct' &&
    (target.hostname !== `db.${PROJECT_REF}.supabase.co` ||
      target.username !== 'postgres' ||
      target.port !== 5432)
  ) {
    throw new Error('Direct database boundary is invalid')
  }
  if (
    target.connection_mode === 'session_pooler' &&
    (!/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(target.hostname) ||
      target.username !== `postgres.${PROJECT_REF}` ||
      target.port !== 5432)
  ) {
    throw new Error('Session-pooler database boundary is invalid')
  }
  if (!['direct', 'session_pooler'].includes(target.connection_mode)) {
    throw new Error('Database connection mode is not allowlisted')
  }
  requiredText(target.database_fingerprint, SHA256, 'database fingerprint')
  return {
    hostname: parsed.hostname,
    username,
    database,
    port,
    connectionMode: target.connection_mode,
  }
}

async function loadCanonicalJson(
  filename,
  expectedHash,
  label,
  repositoryText = false,
) {
  const source = await readFile(filename)
  const bytes = repositoryText ? canonicalRepositoryTextBytes(source) : source
  if (digest(bytes) !== expectedHash) {
    throw new Error(`${label} checksum does not match reviewed evidence`)
  }
  const value = JSON.parse(bytes.toString('utf8'))
  if (bytes.toString('utf8') !== `${canonicalJson(value)}\n`) {
    throw new Error(`${label} is not canonical JSON`)
  }
  return value
}

function gitOutput(args, cwd) {
  const git = resolveNativeExecutable('git')
  const result = spawnSync(git.command, resolvedArguments(git, args), {
    cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  })
  if (result.status !== 0) throw new Error('Git evidence could not be derived')
  return result.stdout.trim()
}

async function spawnBounded(command, args, options) {
  return new Promise((resolve) => {
    let timedOut = false
    let settled = false
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
  const phase = option('phase')
  const manifestInput = option('campaign-manifest')
  const expectedManifestHash = option('expected-manifest-sha256')
  const proofInput = option('deployment-proof')
  const expectedProofHash = option('expected-deployment-proof-sha256')
  if (
    !phase ||
    !PHASE.test(phase) ||
    !manifestInput ||
    !expectedManifestHash ||
    !SHA256.test(expectedManifestHash)
  ) {
    fail(
      'Required: --phase, --campaign-manifest, and --expected-manifest-sha256',
    )
  }
  const proofRole = DEPLOYMENT_PROOF_ROLES.get(phase)
  if (
    (proofRole && (!proofInput || !SHA256.test(expectedProofHash ?? ''))) ||
    (!proofRole && (proofInput || expectedProofHash))
  ) {
    fail(
      'Deployment proof arguments are required only for a deployment-verification phase',
    )
  }
  if (process.argv.length !== (proofRole ? 7 : 5)) {
    fail('Unknown or duplicate activation arguments are forbidden')
  }

  const repository = await realpath(process.cwd())
  const gitRoot = await realpath(
    gitOutput(['rev-parse', '--show-toplevel'], repository),
  )
  if (!samePath(repository, gitRoot)) {
    fail('Activation runner must start at the canonical repository root')
  }
  const actualCommitSha = gitOutput(['rev-parse', 'HEAD'], gitRoot)
  if (!GIT_SHA.test(actualCommitSha)) fail('Git HEAD is invalid')
  const dirty = gitOutput(
    ['status', '--porcelain=v1', '--untracked-files=all'],
    gitRoot,
  )
  if (dirty !== '')
    fail('Activation phases require a completely clean working tree')

  const contractPath = await realpath(
    path.join(gitRoot, 'supabase', 'activation', 'phase-contract.json'),
  )
  const projectIdentityPath = await realpath(
    path.join(gitRoot, 'supabase', 'activation', 'project-identity.v1.json'),
  )
  if (!isWithin(gitRoot, contractPath))
    fail('Phase contract escaped the repository')
  const manifestPath = await verifiedExternalFile(gitRoot, manifestInput)
  const manifest = await loadCanonicalJson(
    manifestPath,
    expectedManifestHash,
    'Campaign manifest',
  )
  rejectSensitiveKeys(manifest)
  exactKeys(
    manifest,
    [
      'campaign_id',
      'config_version',
      'database_target',
      'drain_safety_seconds',
      'expected_event_count',
      'expected_slot_count',
      'max_request_seconds',
      'minimum_lead_seconds',
      'phase_contract_sha256',
      'phase_operations',
      'prepared_commit_sha',
      'project_identity_contract_sha256',
      'production_deployment_id',
      'production_host',
      'production_origin',
      'providers',
      'relation_contract_sha256',
      'scheduler_path',
      'scheduler_url',
      'schema_version',
      'supabase_project_ref',
      'vercel_commit_sha',
      'vercel_environment',
      'vercel_project_id',
      'vercel_team_id',
    ],
    'root',
  )
  requiredText(manifest.campaign_id, UUID, 'campaign ID')
  requiredText(manifest.prepared_commit_sha, GIT_SHA, 'prepared commit SHA')
  requiredText(manifest.config_version, CONFIG_VERSION, 'config version')
  requiredText(
    manifest.phase_contract_sha256,
    SHA256,
    'phase contract checksum',
  )
  requiredText(
    manifest.relation_contract_sha256,
    SHA256,
    'relation contract checksum',
  )
  requiredText(
    manifest.project_identity_contract_sha256,
    SHA256,
    'project identity contract checksum',
  )
  if (
    manifest.schema_version !== 4 ||
    manifest.prepared_commit_sha !== actualCommitSha ||
    manifest.vercel_commit_sha !== actualCommitSha
  ) {
    fail('Campaign commit identity does not match derived Git HEAD')
  }
  if (
    manifest.expected_slot_count !== 52 ||
    manifest.expected_event_count !== 104 ||
    manifest.max_request_seconds !== 120 ||
    manifest.drain_safety_seconds !== 180 ||
    manifest.minimum_lead_seconds !== 900
  ) {
    fail('Campaign run-count or timing contract is invalid')
  }
  exactKeys(
    manifest.providers,
    ['execution', 'market_data', 'news'],
    'provider',
  )
  if (
    manifest.providers.market_data !== 'mock' ||
    manifest.providers.news !== 'mock' ||
    manifest.providers.execution !== 'paper'
  ) {
    fail('Campaign must remain mock and paper-only')
  }
  const projectIdentity = await loadCanonicalJson(
    projectIdentityPath,
    manifest.project_identity_contract_sha256,
    'Project identity contract',
    true,
  )
  validateSchedulerIdentity(manifest, projectIdentity)

  const contract = await loadCanonicalJson(
    contractPath,
    manifest.phase_contract_sha256,
    'Phase contract',
    true,
  )
  exactKeys(contract, ['phases', 'schema_version'], 'phase contract')
  if (contract.schema_version !== 4 || !contract.phases?.[phase]) {
    fail('Requested phase is not present in the reviewed phase contract')
  }
  exactKeys(
    manifest.database_target,
    [
      'connection_mode',
      'database',
      'database_fingerprint',
      'hostname',
      'port',
      'project_ref',
      'sslmode',
      'username',
    ],
    'database target',
  )
  const phaseNames = Object.keys(contract.phases).sort()
  exactKeys(manifest.phase_operations, phaseNames, 'phase operation')
  const frozenIds = []
  for (const phaseName of phaseNames) {
    exactKeys(
      contract.phases[phaseName],
      ['file', 'sha256'],
      `${phaseName} phase`,
    )
    if (!/^[a-z0-9][a-z0-9-]*\.sql$/.test(contract.phases[phaseName].file)) {
      fail('Phase contract contains a non-canonical filename')
    }
    requiredText(
      contract.phases[phaseName].sha256,
      SHA256,
      `${phaseName} checksum`,
    )
    const phaseOperation = manifest.phase_operations[phaseName]
    const keys = ['correlation_id', 'operation_id']
    if (
      phaseName === 'auth-noop-request' ||
      phaseName === 'runtime-config-request'
    ) {
      keys.push('nonce', 'request_id')
    }
    exactKeys(phaseOperation, keys, `${phaseName} operation`)
    requiredText(phaseOperation.operation_id, UUID, `${phaseName} operation ID`)
    requiredText(
      phaseOperation.correlation_id,
      UUID,
      `${phaseName} correlation ID`,
    )
    frozenIds.push(phaseOperation.operation_id, phaseOperation.correlation_id)
    if (
      phaseName === 'auth-noop-request' ||
      phaseName === 'runtime-config-request'
    ) {
      requiredText(phaseOperation.request_id, UUID, `${phaseName} request ID`)
      requiredText(phaseOperation.nonce, UUID, `${phaseName} nonce`)
      frozenIds.push(phaseOperation.request_id, phaseOperation.nonce)
    }
  }
  if (new Set(frozenIds).size !== frozenIds.length) {
    fail(
      'Campaign operation, request, nonce, and correlation IDs must be unique',
    )
  }
  const phaseEntry = contract.phases[phase]
  requiredText(phaseEntry.sha256, SHA256, 'phase checksum')
  const operation = manifest.phase_operations?.[phase]
  requiredText(operation?.operation_id, UUID, 'phase operation ID')
  requiredText(operation?.correlation_id, UUID, 'phase correlation ID')

  const activationRoot = await realpath(
    path.join(gitRoot, 'supabase', 'activation'),
  )
  const scriptPath = await realpath(path.join(activationRoot, phaseEntry.file))
  if (!isWithin(activationRoot, scriptPath))
    fail('Phase file escaped activation root')
  const scriptBytes = canonicalRepositoryTextBytes(await readFile(scriptPath))
  const scriptHash = digest(scriptBytes)
  if (scriptHash !== phaseEntry.sha256) fail('Phase file checksum drifted')

  let deploymentProof
  if (proofRole) {
    const proofPath = await verifiedExternalFile(gitRoot, proofInput)
    deploymentProof = await loadCanonicalJson(
      proofPath,
      expectedProofHash,
      'Deployment proof',
    )
    validateDeploymentProof(
      projectIdentity,
      {
        role: proofRole,
        deploymentId: deploymentProof.deploymentId,
        commitSha: actualCommitSha,
        productionOrigin: manifest.production_origin,
      },
      deploymentProof,
    )
  }

  const databaseUrl = process.env.CAPITAL_LAB_DATABASE_URL
  if (!databaseUrl)
    fail('CAPITAL_LAB_DATABASE_URL is required and never printed')
  const target = validateDatabaseTarget(databaseUrl, manifest.database_target)
  const psql = resolveNativeExecutable('psql')
  const psqlArguments = [
    '-X',
    '--no-psqlrc',
    '--set',
    'ON_ERROR_STOP=1',
    '--set',
    `campaign_id=${manifest.campaign_id}`,
    '--set',
    `expected_commit_sha=${actualCommitSha}`,
    '--set',
    `config_version=${manifest.config_version}`,
    '--set',
    `manifest_sha256=${expectedManifestHash}`,
    '--set',
    `phase_contract_sha256=${manifest.phase_contract_sha256}`,
    '--set',
    `relation_contract_sha256=${manifest.relation_contract_sha256}`,
    '--set',
    `campaign_manifest_json=${canonicalJson(manifest)}`,
    '--set',
    `expected_database_fingerprint=${manifest.database_target.database_fingerprint}`,
    '--set',
    `production_origin=${manifest.production_origin}`,
    '--set',
    `scheduler_path=${manifest.scheduler_path}`,
    '--set',
    `scheduler_url=${manifest.scheduler_url}`,
    '--set',
    `production_deployment_id=${manifest.production_deployment_id}`,
    '--set',
    `vercel_environment=${manifest.vercel_environment}`,
    '--set',
    `operation_id=${operation.operation_id}`,
    '--set',
    `correlation_id=${operation.correlation_id}`,
  ]
  if (deploymentProof) {
    psqlArguments.push(
      '--set',
      `deployment_proof_json=${canonicalJson(deploymentProof)}`,
      '--set',
      `deployment_proof_sha256=${expectedProofHash}`,
    )
  }
  psqlArguments.push('--file', scriptPath)
  const result = await spawnBounded(
    psql.command,
    resolvedArguments(psql, psqlArguments),
    {
      cwd: gitRoot,
      env: {
        ...process.env,
        PGDATABASE: databaseUrl,
        PGCONNECT_TIMEOUT: '10',
        PGOPTIONS: '-c statement_timeout=150000 -c lock_timeout=10000',
      },
      stdio: 'inherit',
    },
  )
  const unknown =
    result.timedOut ||
    result.error !== null ||
    result.signal !== null ||
    result.code === null
  process.stdout.write(
    `${JSON.stringify({
      schemaVersion: 4,
      phase,
      campaignId: manifest.campaign_id,
      operationId: operation.operation_id,
      correlationId: operation.correlation_id,
      projectRef: PROJECT_REF,
      derivedCommitSha: actualCommitSha,
      connectionMode: target.connectionMode,
      databaseFingerprint: manifest.database_target.database_fingerprint,
      manifestSha256: expectedManifestHash,
      phaseContractSha256: manifest.phase_contract_sha256,
      scriptPath: path.relative(gitRoot, scriptPath).replaceAll('\\', '/'),
      scriptSha256: scriptHash,
      outcome: unknown ? 'unknown' : result.code === 0 ? 'completed' : 'failed',
      exitCode: result.code,
      signal: result.signal,
      timedOut: result.timedOut,
    })}\n`,
  )
  process.exit(unknown ? 3 : (result.code ?? 1))
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main().catch((error) =>
    fail(error instanceof Error ? error.message : 'Activation runner failed'),
  )
}
