import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

import { resolvedArguments, resolveNativeExecutable } from './safe-process.mjs'

const COMMIT_SHA = /^[0-9a-f]{40}$/u
const CONTAINER_ID = /^[0-9a-f]{64}$/u
const PROJECT_ID = /^[a-z0-9][a-z0-9-]{5,39}$/u
const RUN_ID = /^run-[a-z0-9][a-z0-9-]{4,48}$/u
const NETWORK_NAME = /^[a-z0-9][a-z0-9-]{5,62}$/u
const PROCESS_TIMEOUT_MS = 30_000

export const LOCAL_SUPABASE_NETWORK_BINDING_OPTION =
  'com.docker.network.bridge.host_binding_ipv4'
export const LOCAL_SUPABASE_NETWORK_BINDING_VALUE = '127.0.0.1'

const LABEL_KEYS = [
  'io.capital-lab.commit-sha',
  'io.capital-lab.owner',
  'io.capital-lab.project-id',
  'io.capital-lab.role',
  'io.capital-lab.run-id',
]

function exactObject(value, expectedKeys) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join('\n') === [...expectedKeys].sort().join('\n')
  )
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function stackRole(role) {
  if (role === 'peer_reference') return 'reference'
  if (!['reference', 'restore', 'source'].includes(role)) {
    throw new Error('Owned local Supabase network role is invalid')
  }
  return role
}

export function ownedLocalSupabaseNetworkSpec(role, target, commitSha) {
  const normalizedRole = stackRole(role)
  if (
    !COMMIT_SHA.test(commitSha ?? '') ||
    !PROJECT_ID.test(target?.projectId ?? '') ||
    !RUN_ID.test(target?.runId ?? '') ||
    target?.container !== `supabase_db_${target.projectId}`
  ) {
    throw new Error('Owned local Supabase network identity is invalid')
  }
  const networkName = `capital-lab-net-${target.projectId}`
  if (!NETWORK_NAME.test(networkName)) {
    throw new Error('Owned local Supabase network name is invalid')
  }
  return {
    commitSha,
    databaseContainer: target.container,
    labels: {
      'io.capital-lab.commit-sha': commitSha,
      'io.capital-lab.owner': 'owned-local-supabase-stack-v1',
      'io.capital-lab.project-id': target.projectId,
      'io.capital-lab.role': normalizedRole,
      'io.capital-lab.run-id': target.runId,
    },
    networkName,
    projectId: target.projectId,
    role: normalizedRole,
    runId: target.runId,
  }
}

function ownedContainerNames(containers, spec) {
  if (!exactObject(containers, Object.keys(containers ?? {}))) {
    throw new Error('Owned local Supabase network containers are invalid')
  }
  const names = []
  const suffix = `_${spec.projectId}`
  for (const [containerId, attachment] of Object.entries(containers)) {
    const name = attachment?.Name
    if (
      !CONTAINER_ID.test(containerId) ||
      typeof name !== 'string' ||
      !/^supabase_[a-z0-9][a-z0-9_-]{0,63}$/u.test(
        name.slice(0, -suffix.length),
      ) ||
      !name.endsWith(suffix)
    ) {
      throw new Error('Owned local Supabase network has a foreign container')
    }
    names.push(name)
  }
  return names.sort()
}

export function validateOwnedLocalSupabaseNetworkInspection(
  inspections,
  spec,
  expectedState,
) {
  if (!Array.isArray(inspections) || inspections.length !== 1) {
    throw new Error('Owned local Supabase network inspection is not unique')
  }
  const inspection = inspections[0]
  if (
    inspection?.Name !== spec.networkName ||
    !CONTAINER_ID.test(inspection?.Id ?? '') ||
    inspection?.Driver !== 'bridge' ||
    inspection?.Scope !== 'local' ||
    !exactObject(inspection?.Options, [
      LOCAL_SUPABASE_NETWORK_BINDING_OPTION,
    ]) ||
    inspection.Options[LOCAL_SUPABASE_NETWORK_BINDING_OPTION] !==
      LOCAL_SUPABASE_NETWORK_BINDING_VALUE ||
    !exactObject(inspection?.Labels, LABEL_KEYS) ||
    LABEL_KEYS.some((key) => inspection.Labels[key] !== spec.labels[key])
  ) {
    throw new Error('Owned local Supabase network contract is invalid')
  }
  const containerNames = ownedContainerNames(
    inspection?.Containers ?? null,
    spec,
  )
  if (
    (expectedState === 'empty' && containerNames.length !== 0) ||
    (expectedState === 'running' &&
      (containerNames.length === 0 ||
        !containerNames.includes(spec.databaseContainer))) ||
    !['empty', 'owned_or_empty', 'running'].includes(expectedState)
  ) {
    throw new Error('Owned local Supabase network attachment state is invalid')
  }
  return {
    attachedContainerCount: containerNames.length,
    databaseContainerAttached: containerNames.includes(spec.databaseContainer),
    driver: 'bridge',
    hostBindingIpv4: LOCAL_SUPABASE_NETWORK_BINDING_VALUE,
    networkId: inspection.Id,
    networkIdSha256: sha256(inspection.Id),
    networkName: spec.networkName,
    projectId: spec.projectId,
    role: spec.role,
    runId: spec.runId,
  }
}

function runDocker(args) {
  const executable = resolveNativeExecutable('docker')
  return spawnSync(executable.command, resolvedArguments(executable, args), {
    encoding: 'utf8',
    shell: false,
    timeout: PROCESS_TIMEOUT_MS,
    windowsHide: true,
  })
}

function successful(result) {
  return (
    result?.status === 0 &&
    !result?.signal &&
    !result?.error &&
    typeof result?.stdout === 'string'
  )
}

export function inspectOwnedLocalSupabaseNetwork(spec, expectedState) {
  const result = runDocker(['network', 'inspect', spec.networkName])
  if (!successful(result)) {
    throw new Error('Owned local Supabase network inspection failed closed')
  }
  let inspections
  try {
    inspections = JSON.parse(result.stdout)
  } catch {
    throw new Error('Owned local Supabase network inspection is invalid JSON')
  }
  return validateOwnedLocalSupabaseNetworkInspection(
    inspections,
    spec,
    expectedState,
  )
}

export function createOwnedLocalSupabaseNetwork(spec) {
  const labelArguments = LABEL_KEYS.flatMap((key) => [
    '--label',
    `${key}=${spec.labels[key]}`,
  ])
  const result = runDocker([
    'network',
    'create',
    '--driver',
    'bridge',
    '--opt',
    `${LOCAL_SUPABASE_NETWORK_BINDING_OPTION}=${LOCAL_SUPABASE_NETWORK_BINDING_VALUE}`,
    ...labelArguments,
    spec.networkName,
  ])
  if (!successful(result)) {
    throw new Error(
      'Owned local Supabase network creation or uniqueness proof failed closed',
    )
  }
  return inspectOwnedLocalSupabaseNetwork(spec, 'empty')
}

export function removeOwnedLocalSupabaseNetwork(spec) {
  const inspection = inspectOwnedLocalSupabaseNetwork(spec, 'empty')
  const removal = runDocker(['network', 'rm', inspection.networkId])
  if (!successful(removal)) {
    throw new Error('Owned local Supabase network removal failed closed')
  }
  const byId = runDocker([
    'network',
    'ls',
    '--no-trunc',
    '--filter',
    `id=${inspection.networkId}`,
    '--format',
    '{{.ID}}',
  ])
  const byName = runDocker([
    'network',
    'ls',
    '--filter',
    `name=^${spec.networkName}$`,
    '--format',
    '{{.Name}}',
  ])
  if (
    !successful(byId) ||
    !successful(byName) ||
    byId.stdout.trim() !== '' ||
    byName.stdout.trim() !== ''
  ) {
    throw new Error('Owned local Supabase network cleanup is incomplete')
  }
  return {
    networkIdSha256: inspection.networkIdSha256,
    networkName: spec.networkName,
    projectId: spec.projectId,
    role: spec.role,
    runId: spec.runId,
  }
}

export function safeOwnedLocalSupabaseNetworkEvidence(status, evidence) {
  if (
    ![
      'owned_local_supabase_network_created',
      'owned_local_supabase_network_removed',
      'owned_local_supabase_network_verified',
    ].includes(status) ||
    !NETWORK_NAME.test(evidence?.networkName ?? '') ||
    !PROJECT_ID.test(evidence?.projectId ?? '') ||
    !RUN_ID.test(evidence?.runId ?? '') ||
    !['reference', 'restore', 'source'].includes(evidence?.role) ||
    !/^[0-9a-f]{64}$/u.test(evidence?.networkIdSha256 ?? '')
  ) {
    throw new Error('Owned local Supabase network evidence is invalid')
  }
  return {
    status,
    role: evidence.role,
    runId: evidence.runId,
    projectId: evidence.projectId,
    networkName: evidence.networkName,
    networkIdSha256: evidence.networkIdSha256,
    driver: evidence.driver ?? 'bridge',
    hostBindingIpv4:
      evidence.hostBindingIpv4 ?? LOCAL_SUPABASE_NETWORK_BINDING_VALUE,
    attachedContainerCount: evidence.attachedContainerCount ?? 0,
    databaseContainerAttached: evidence.databaseContainerAttached ?? false,
  }
}
