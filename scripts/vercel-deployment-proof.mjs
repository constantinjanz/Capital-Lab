import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { chmod, readFile, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { canonicalRepositoryTextBytes } from './lib/canonical-repository-bytes.mjs'
import {
  newExternalPath,
  verifyCreatedExternalPath,
  verifiedExternalFile,
} from './lib/safe-artifact-path.mjs'
import {
  resolvedArguments,
  resolveNativeExecutable,
} from './lib/safe-process.mjs'

const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]{20,64}$/u
const GIT_SHA = /^[0-9a-f]{40}$/u
const VERCEL_ID = /^(?:prj|team)_[A-Za-z0-9]{20,64}$/u
const ROLES = new Set([
  'auth_disabled',
  'no_ai_runtime_enabled',
  'shutdown_disabled',
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

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

export function deploymentEvidenceHash(evidence) {
  const fields = [
    'capital-lab-vercel-deployment-proof-v1',
    evidence.schemaVersion,
    evidence.role,
    evidence.vercelTeamId,
    evidence.vercelProjectId,
    evidence.supabaseProjectRef,
    evidence.deploymentId,
    evidence.commitSha,
    evidence.environment,
    evidence.target,
    evidence.readyState,
    evidence.productionOrigin,
    evidence.productionHost,
    evidence.immutableDeploymentOrigin,
    evidence.immutableDeploymentHost,
    evidence.schedulerPath,
    evidence.schedulerUrl,
    evidence.runtimeConfigPath,
    evidence.runtimeConfigUrl,
  ]
  return sha256(fields.map(String).join('\u001f'))
}

function exactKeys(value, expected, label) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify([...expected].sort())
  ) {
    throw new Error(`${label} has unexpected fields`)
  }
}

function git(repository, args) {
  const executable = resolveNativeExecutable('git')
  const result = spawnSync(
    executable.command,
    resolvedArguments(executable, args),
    {
      cwd: repository,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    },
  )
  if (result.status !== 0 || result.signal || result.error) {
    throw new Error('Git deployment identity could not be derived')
  }
  return result.stdout.trim()
}

function canonicalOrigin(value, allowedHosts) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('Production origin is invalid')
  }
  const authority = value.slice(value.indexOf('//') + 2).split(/[/?#]/u, 1)[0]
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    authority.includes(':') ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash ||
    !allowedHosts.includes(parsed.hostname) ||
    value !== `https://${parsed.hostname}`
  ) {
    throw new Error('Production origin is not an exact reviewed alias')
  }
  return parsed
}

export function validateProjectIdentityContract(contract) {
  exactKeys(
    contract,
    [
      'allowedProductionHosts',
      'allowedDeploymentHostSuffixes',
      'runtimeConfigPath',
      'schemaVersion',
      'schedulerPath',
      'supabaseProjectRef',
      'vercelProjectId',
      'vercelTeamId',
    ],
    'Project identity contract',
  )
  if (
    contract.schemaVersion !== 2 ||
    !VERCEL_ID.test(contract.vercelTeamId) ||
    !VERCEL_ID.test(contract.vercelProjectId) ||
    !/^[a-z]{20}$/u.test(contract.supabaseProjectRef) ||
    contract.schedulerPath !== '/api/internal/scheduler' ||
    contract.runtimeConfigPath !== '/api/internal/scheduler' ||
    !Array.isArray(contract.allowedProductionHosts) ||
    contract.allowedProductionHosts.length === 0 ||
    new Set(contract.allowedProductionHosts).size !==
      contract.allowedProductionHosts.length ||
    contract.allowedProductionHosts.some(
      (host) =>
        typeof host !== 'string' ||
        !/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])$/u.test(host),
    ) ||
    !Array.isArray(contract.allowedDeploymentHostSuffixes) ||
    canonicalJson(contract.allowedDeploymentHostSuffixes) !==
      canonicalJson(['.vercel.app'])
  ) {
    throw new Error('Project identity contract is invalid')
  }
  return contract
}

export function validateDeploymentMetadata(contract, expected, deployment) {
  validateProjectIdentityContract(contract)
  exactKeys(
    expected,
    ['commitSha', 'deploymentId', 'productionOrigin', 'role'],
    'Deployment expectation',
  )
  if (
    !ROLES.has(expected.role) ||
    !DEPLOYMENT_ID.test(expected.deploymentId) ||
    !GIT_SHA.test(expected.commitSha)
  ) {
    throw new Error('Deployment expectation is invalid')
  }
  const origin = canonicalOrigin(
    expected.productionOrigin,
    contract.allowedProductionHosts,
  )
  const aliases = Array.isArray(deployment?.alias) ? deployment.alias : []
  const immutableDeploymentOrigin = canonicalOrigin(
    `https://${deployment?.url ?? ''}`,
    [deployment?.url].filter(Boolean),
  )
  if (
    !contract.allowedDeploymentHostSuffixes.some((suffix) =>
      immutableDeploymentOrigin.hostname.endsWith(suffix),
    )
  ) {
    throw new Error(
      'Immutable Vercel deployment host is outside reviewed rules',
    )
  }
  if (
    deployment?.id !== expected.deploymentId ||
    deployment?.projectId !== contract.vercelProjectId ||
    deployment?.teamId !== contract.vercelTeamId ||
    deployment?.target !== 'production' ||
    deployment?.readyState !== 'READY' ||
    deployment?.meta?.githubCommitSha !== expected.commitSha ||
    aliases.length === 0 ||
    !aliases.includes(origin.hostname) ||
    aliases.some((alias) => typeof alias !== 'string')
  ) {
    throw new Error(
      'Vercel deployment metadata does not match the reviewed identity',
    )
  }
  const schedulerUrl = `${origin.origin}${contract.schedulerPath}`
  const runtimeConfigUrl = `${immutableDeploymentOrigin.origin}${contract.runtimeConfigPath}`
  return {
    schemaVersion: 2,
    role: expected.role,
    vercelTeamId: contract.vercelTeamId,
    vercelProjectId: contract.vercelProjectId,
    supabaseProjectRef: contract.supabaseProjectRef,
    deploymentId: expected.deploymentId,
    commitSha: expected.commitSha,
    environment: 'production',
    target: 'production',
    readyState: 'READY',
    productionOrigin: origin.origin,
    productionHost: origin.hostname,
    immutableDeploymentOrigin: immutableDeploymentOrigin.origin,
    immutableDeploymentHost: immutableDeploymentOrigin.hostname,
    schedulerPath: contract.schedulerPath,
    schedulerUrl,
    runtimeConfigPath: contract.runtimeConfigPath,
    runtimeConfigUrl,
  }
}

export function validateDeploymentProof(contract, expected, proof) {
  const immutable = validateDeploymentMetadata(contract, expected, {
    id: proof?.deploymentId,
    projectId: proof?.vercelProjectId,
    teamId: proof?.vercelTeamId,
    target: proof?.target,
    readyState: proof?.readyState,
    meta: { githubCommitSha: proof?.commitSha },
    alias: [proof?.productionHost],
    url: proof?.immutableDeploymentHost,
  })
  exactKeys(
    proof,
    [...Object.keys(immutable), 'evidenceHash', 'verifiedAt'],
    'Deployment proof',
  )
  if (
    canonicalJson(
      Object.fromEntries(
        Object.keys(immutable).map((key) => [key, proof[key]]),
      ),
    ) !== canonicalJson(immutable) ||
    typeof proof.verifiedAt !== 'string' ||
    Number.isNaN(Date.parse(proof.verifiedAt)) ||
    proof.evidenceHash !== deploymentEvidenceHash(immutable)
  ) {
    throw new Error('Deployment proof is not canonical immutable evidence')
  }
  return proof
}

async function main() {
  const options = Object.fromEntries(
    process.argv.slice(2).map((argument) => {
      const match = /^--([a-z-]+)=(.+)$/u.exec(argument)
      if (!match) throw new Error('Deployment proof arguments are invalid')
      return [match[1], match[2]]
    }),
  )
  exactKeys(
    options,
    ['commit-sha', 'deployment-id', 'output', 'production-origin', 'role'],
    'Deployment proof arguments',
  )
  const repository = await realpath(process.cwd())
  const actualCommitSha = git(repository, ['rev-parse', 'HEAD'])
  if (
    actualCommitSha !== options['commit-sha'] ||
    git(repository, ['status', '--porcelain=v1', '--untracked-files=all'])
  ) {
    throw new Error('Deployment proof requires the exact clean Git HEAD')
  }
  const contractPath = path.join(
    repository,
    'supabase',
    'activation',
    'project-identity.v1.json',
  )
  const contractBytes = canonicalRepositoryTextBytes(
    await readFile(contractPath),
  )
  const contract = validateProjectIdentityContract(
    JSON.parse(contractBytes.toString('utf8')),
  )
  if (contractBytes.toString('utf8') !== `${canonicalJson(contract)}\n`) {
    throw new Error('Project identity contract is not canonical JSON')
  }
  const outputPath = await newExternalPath(repository, options.output)
  const token = process.env.VERCEL_TOKEN
  if (!token) throw new Error('VERCEL_TOKEN is required and never logged')
  const endpoint = new URL(
    `/v13/deployments/${encodeURIComponent(options['deployment-id'])}`,
    'https://api.vercel.com',
  )
  endpoint.searchParams.set('teamId', contract.vercelTeamId)
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  })
  if (
    !response.ok ||
    response.redirected ||
    response.url !== endpoint.toString()
  ) {
    throw new Error('Read-only Vercel deployment lookup failed closed')
  }
  const immutable = validateDeploymentMetadata(
    contract,
    {
      role: options.role,
      deploymentId: options['deployment-id'],
      commitSha: options['commit-sha'],
      productionOrigin: options['production-origin'],
    },
    await response.json(),
  )
  const proof = {
    ...immutable,
    evidenceHash: deploymentEvidenceHash(immutable),
    verifiedAt: new Date().toISOString(),
  }
  const proofBytes = Buffer.from(`${canonicalJson(proof)}\n`)
  await writeFile(outputPath, proofBytes, {
    mode: 0o600,
    flag: 'wx',
  })
  await chmod(outputPath, 0o600)
  await verifyCreatedExternalPath(repository, outputPath)
  const verifiedOutputPath = await verifiedExternalFile(repository, outputPath)
  if (!(await readFile(verifiedOutputPath)).equals(proofBytes)) {
    throw new Error('Deployment proof identity changed after creation')
  }
  process.stdout.write(
    `${JSON.stringify({ status: 'deployment_proof_created', role: proof.role, deploymentId: proof.deploymentId, proofSha256: sha256(`${canonicalJson(proof)}\n`), projectContractSha256: sha256(contractBytes) })}\n`,
  )
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : 'Deployment proof failed',
    )
    process.exit(1)
  })
}
