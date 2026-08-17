import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import {
  LOCAL_CI_HOST,
  LOCAL_CI_IMAGE,
  LOCAL_CI_IMAGE_ARCHITECTURE,
  LOCAL_CI_IMAGE_ID,
  LOCAL_CI_IMAGE_OS,
  LOCAL_CI_IMAGE_REPO_DIGEST,
} from './owned-local-ci-stack.mjs'

const COMMIT_SHA = /^[0-9a-f]{40}$/u
const IMAGE_ID = /^sha256:[0-9a-f]{64}$/u
const SAFE_CONFIG_IMAGE =
  /^(?:ghcr\.io|public\.ecr\.aws)\/supabase\/postgres:[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/u
const SAFE_REPO_DIGEST =
  /^(?:ghcr\.io|public\.ecr\.aws)\/supabase\/postgres@sha256:[0-9a-f]{64}$/u
const SAFE_OS = new Set(['darwin', 'freebsd', 'linux', 'windows'])
const SAFE_ARCHITECTURE = new Set([
  '386',
  'amd64',
  'arm',
  'arm64',
  'ppc64le',
  'riscv64',
  's390x',
])
const ROLES = new Set(['peer_reference', 'reference', 'restore', 'source'])
const FAILURE_STAGES = new Set([
  'container_inspect',
  'container_shape',
  'container_binding',
  'image_inspect',
  'image_shape',
  'immutable_identity',
])
const MISMATCH_FIELDS = new Set([
  'architecture',
  'architecture_shape',
  'binding_count',
  'binding_host_ip',
  'binding_host_port',
  'config_image',
  'config_image_shape',
  'container_id_shape',
  'container_image_id',
  'container_image_id_shape',
  'container_inspect_unavailable',
  'container_json',
  'container_name',
  'container_result_count',
  'container_running',
  'expected_repo_digest_missing',
  'image_inspect_id',
  'image_inspect_id_shape',
  'image_inspect_unavailable',
  'image_json',
  'image_result_count',
  'os',
  'os_shape',
  'repo_digest_count',
  'repo_digest_value',
  'repo_digests_shape',
])
const HOST_IP_KINDS = new Set([
  'loopback_v4',
  'other',
  'wildcard_v4',
  'wildcard_v6',
])
const DIAGNOSTIC_KEYS = [
  'architecture_match',
  'binding_count',
  'binding_host_ip_kinds',
  'config_image_match',
  'container_image_id_match',
  'expected_repo_digest_present',
  'failure_stage',
  'host_port_match',
  'image_inspect_id_match',
  'mismatch_fields',
  'observed_runtime',
  'os_match',
  'repo_digest_count',
]
const OBSERVED_RUNTIME_KEYS = [
  'architecture',
  'configImage',
  'containerImageId',
  'imageInspectId',
  'os',
  'repoDigests',
]
const EVIDENCE_KEYS = [
  ...DIAGNOSTIC_KEYS,
  'commitSha',
  'role',
  'schemaVersion',
  'status',
]
const MAX_REPO_DIGESTS = 4
const FAILURE_MESSAGES = {
  container_inspect: 'Owned local database container proof is unavailable',
  container_shape: 'Owned local database container is not unique or valid',
  container_binding: 'Owned local database container binding is invalid',
  image_inspect: 'Owned local database image proof is unavailable',
  image_shape: 'Owned local database image inspection is not unique or valid',
  immutable_identity:
    'Owned local database immutable image identity is invalid',
}

function exactKeys(value, expected) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join('\n') === [...expected].sort().join('\n')
  )
}

function sortedUnique(values) {
  return [...new Set(values)].sort()
}

function nullableBoolean(value) {
  return value === null || typeof value === 'boolean'
}

export function classifyLocalContainerHostIp(value) {
  if (value === LOCAL_CI_HOST) return 'loopback_v4'
  if (value === '0.0.0.0') return 'wildcard_v4'
  if (value === '::') return 'wildcard_v6'
  return 'other'
}

function safeConfigImage(value) {
  return typeof value === 'string' && SAFE_CONFIG_IMAGE.test(value)
    ? value
    : null
}

function safeImageId(value) {
  return typeof value === 'string' && IMAGE_ID.test(value) ? value : null
}

function safeOs(value) {
  return typeof value === 'string' && SAFE_OS.has(value) ? value : null
}

function safeArchitecture(value) {
  return typeof value === 'string' && SAFE_ARCHITECTURE.has(value)
    ? value
    : null
}

function safeRepoDigests(value) {
  if (!Array.isArray(value)) return []
  return sortedUnique(
    value.filter(
      (entry) => typeof entry === 'string' && SAFE_REPO_DIGEST.test(entry),
    ),
  ).slice(0, MAX_REPO_DIGESTS)
}

function inspectedContainer(containerInspections) {
  return Array.isArray(containerInspections) &&
    containerInspections.length === 1
    ? containerInspections[0]
    : null
}

function inspectedImage(imageInspections) {
  return Array.isArray(imageInspections) && imageInspections.length === 1
    ? imageInspections[0]
    : null
}

function diagnosticFields(
  containerInspections,
  imageInspections,
  expectedContainer,
) {
  const container = inspectedContainer(containerInspections)
  const image = inspectedImage(imageInspections)
  const bindings = Array.isArray(
    container?.NetworkSettings?.Ports?.['5432/tcp'],
  )
    ? container.NetworkSettings.Ports['5432/tcp']
    : []
  const repoDigests = Array.isArray(image?.RepoDigests) ? image.RepoDigests : []
  return {
    architecture_match:
      image === null
        ? null
        : image.Architecture === LOCAL_CI_IMAGE_ARCHITECTURE,
    binding_count: container === null ? null : bindings.length,
    binding_host_ip_kinds:
      container === null
        ? []
        : sortedUnique(
            bindings.map((binding) =>
              classifyLocalContainerHostIp(binding?.HostIp),
            ),
          ),
    config_image_match:
      container === null ? null : container?.Config?.Image === LOCAL_CI_IMAGE,
    container_image_id_match:
      container === null ? null : container?.Image === LOCAL_CI_IMAGE_ID,
    expected_repo_digest_present:
      image === null ? null : repoDigests.includes(LOCAL_CI_IMAGE_REPO_DIGEST),
    host_port_match:
      container === null
        ? null
        : bindings.length > 0 &&
          bindings.every(
            (binding) => binding?.HostPort === expectedContainer.port,
          ),
    image_inspect_id_match:
      image === null ? null : image?.Id === LOCAL_CI_IMAGE_ID,
    observed_runtime: {
      architecture:
        image === null ? null : safeArchitecture(image.Architecture),
      configImage:
        container === null ? null : safeConfigImage(container?.Config?.Image),
      containerImageId:
        container === null ? null : safeImageId(container?.Image),
      imageInspectId: image === null ? null : safeImageId(image?.Id),
      os: image === null ? null : safeOs(image?.Os),
      repoDigests: image === null ? [] : safeRepoDigests(image?.RepoDigests),
    },
    os_match: image === null ? null : image?.Os === LOCAL_CI_IMAGE_OS,
    repo_digest_count: image === null ? null : repoDigests.length,
  }
}

function buildDiagnostic(
  failureStage,
  mismatchFields,
  containerInspections,
  imageInspections,
  expectedContainer,
) {
  const sortedMismatches = sortedUnique(mismatchFields)
  if (
    !FAILURE_STAGES.has(failureStage) ||
    sortedMismatches.length === 0 ||
    sortedMismatches.some((field) => !MISMATCH_FIELDS.has(field))
  ) {
    throw new Error('Local container identity diagnostic enum is invalid')
  }
  return {
    failure_stage: failureStage,
    mismatch_fields: sortedMismatches,
    ...diagnosticFields(
      containerInspections,
      imageInspections,
      expectedContainer,
    ),
  }
}

export function localContainerInspectFailureDiagnostic(
  failureStage,
  mismatchField,
  expectedContainer,
  containerInspections = /** @type {unknown} */ (null),
) {
  return buildDiagnostic(
    failureStage,
    [mismatchField],
    containerInspections,
    null,
    expectedContainer,
  )
}

export function diagnoseOwnedLocalDatabaseContainer(
  containerInspections,
  expectedContainer,
) {
  if (!Array.isArray(containerInspections)) {
    return buildDiagnostic(
      'container_shape',
      ['container_json'],
      null,
      null,
      expectedContainer,
    )
  }
  if (containerInspections.length !== 1) {
    return buildDiagnostic(
      'container_shape',
      ['container_result_count'],
      containerInspections,
      null,
      expectedContainer,
    )
  }
  const inspection = containerInspections[0]
  const shape = []
  const binding = []
  const bindings = Array.isArray(
    inspection?.NetworkSettings?.Ports?.['5432/tcp'],
  )
    ? inspection.NetworkSettings.Ports['5432/tcp']
    : []
  if (!/^[0-9a-f]{64}$/u.test(inspection?.Id ?? ''))
    shape.push('container_id_shape')
  if (!IMAGE_ID.test(inspection?.Image ?? ''))
    shape.push('container_image_id_shape')
  if (!safeConfigImage(inspection?.Config?.Image))
    shape.push('config_image_shape')
  if (inspection?.Name !== `/${expectedContainer.container}`)
    binding.push('container_name')
  if (inspection?.State?.Running !== true) binding.push('container_running')
  if (inspection?.Config?.Image !== LOCAL_CI_IMAGE) binding.push('config_image')
  if (bindings.length !== 1) binding.push('binding_count')
  if (
    bindings.some(
      (entry) => classifyLocalContainerHostIp(entry?.HostIp) !== 'loopback_v4',
    )
  ) {
    binding.push('binding_host_ip')
  }
  if (
    bindings.length > 0 &&
    bindings.some((entry) => entry?.HostPort !== expectedContainer.port)
  ) {
    binding.push('binding_host_port')
  }
  if (shape.length > 0) {
    return buildDiagnostic(
      'container_shape',
      shape,
      containerInspections,
      null,
      expectedContainer,
    )
  }
  if (binding.length > 0) {
    return buildDiagnostic(
      'container_binding',
      binding,
      containerInspections,
      null,
      expectedContainer,
    )
  }
  return null
}

export function diagnoseOwnedLocalDatabaseImage(
  containerInspection,
  imageInspections,
  expectedContainer,
) {
  const containers = [containerInspection]
  if (!Array.isArray(imageInspections)) {
    return buildDiagnostic(
      'image_shape',
      ['image_json'],
      containers,
      null,
      expectedContainer,
    )
  }
  if (imageInspections.length !== 1) {
    return buildDiagnostic(
      'image_shape',
      ['image_result_count'],
      containers,
      imageInspections,
      expectedContainer,
    )
  }
  const image = imageInspections[0]
  const shape = []
  const immutable = []
  if (!IMAGE_ID.test(image?.Id ?? '')) shape.push('image_inspect_id_shape')
  if (!Array.isArray(image?.RepoDigests)) {
    shape.push('repo_digests_shape')
  } else if (
    image.RepoDigests.some(
      (entry) => typeof entry !== 'string' || !SAFE_REPO_DIGEST.test(entry),
    )
  ) {
    shape.push('repo_digests_shape')
  }
  if (!safeOs(image?.Os)) shape.push('os_shape')
  if (!safeArchitecture(image?.Architecture)) shape.push('architecture_shape')
  if (shape.length > 0) {
    return buildDiagnostic(
      'image_shape',
      shape,
      containers,
      imageInspections,
      expectedContainer,
    )
  }
  if (containerInspection?.Image !== LOCAL_CI_IMAGE_ID)
    immutable.push('container_image_id')
  if (image.Id !== LOCAL_CI_IMAGE_ID) immutable.push('image_inspect_id')
  if (image.Os !== LOCAL_CI_IMAGE_OS) immutable.push('os')
  if (image.Architecture !== LOCAL_CI_IMAGE_ARCHITECTURE)
    immutable.push('architecture')
  if (image.RepoDigests.length !== 1) immutable.push('repo_digest_count')
  if (!image.RepoDigests.includes(LOCAL_CI_IMAGE_REPO_DIGEST))
    immutable.push('expected_repo_digest_missing')
  if (image.RepoDigests.some((entry) => entry !== LOCAL_CI_IMAGE_REPO_DIGEST))
    immutable.push('repo_digest_value')
  if (immutable.length > 0) {
    return buildDiagnostic(
      'immutable_identity',
      immutable,
      containers,
      imageInspections,
      expectedContainer,
    )
  }
  return null
}

function validateDiagnostic(diagnostic) {
  if (
    !exactKeys(diagnostic, DIAGNOSTIC_KEYS) ||
    !FAILURE_STAGES.has(diagnostic.failure_stage) ||
    !Array.isArray(diagnostic.mismatch_fields) ||
    diagnostic.mismatch_fields.length === 0 ||
    diagnostic.mismatch_fields.some((field) => !MISMATCH_FIELDS.has(field)) ||
    diagnostic.mismatch_fields.join('\n') !==
      sortedUnique(diagnostic.mismatch_fields).join('\n') ||
    !Number.isSafeInteger(diagnostic.binding_count ?? 0) ||
    (diagnostic.binding_count ?? 0) < 0 ||
    !Array.isArray(diagnostic.binding_host_ip_kinds) ||
    diagnostic.binding_host_ip_kinds.some((kind) => !HOST_IP_KINDS.has(kind)) ||
    diagnostic.binding_host_ip_kinds.join('\n') !==
      sortedUnique(diagnostic.binding_host_ip_kinds).join('\n') ||
    !nullableBoolean(diagnostic.host_port_match) ||
    !nullableBoolean(diagnostic.config_image_match) ||
    !nullableBoolean(diagnostic.container_image_id_match) ||
    !nullableBoolean(diagnostic.image_inspect_id_match) ||
    !nullableBoolean(diagnostic.os_match) ||
    !nullableBoolean(diagnostic.architecture_match) ||
    !nullableBoolean(diagnostic.expected_repo_digest_present) ||
    !Number.isSafeInteger(diagnostic.repo_digest_count ?? 0) ||
    (diagnostic.repo_digest_count ?? 0) < 0 ||
    !exactKeys(diagnostic.observed_runtime, OBSERVED_RUNTIME_KEYS) ||
    (diagnostic.observed_runtime.configImage !== null &&
      !SAFE_CONFIG_IMAGE.test(diagnostic.observed_runtime.configImage)) ||
    (diagnostic.observed_runtime.containerImageId !== null &&
      !IMAGE_ID.test(diagnostic.observed_runtime.containerImageId)) ||
    (diagnostic.observed_runtime.imageInspectId !== null &&
      !IMAGE_ID.test(diagnostic.observed_runtime.imageInspectId)) ||
    (diagnostic.observed_runtime.os !== null &&
      !SAFE_OS.has(diagnostic.observed_runtime.os)) ||
    (diagnostic.observed_runtime.architecture !== null &&
      !SAFE_ARCHITECTURE.has(diagnostic.observed_runtime.architecture)) ||
    !Array.isArray(diagnostic.observed_runtime.repoDigests) ||
    diagnostic.observed_runtime.repoDigests.length > MAX_REPO_DIGESTS ||
    diagnostic.observed_runtime.repoDigests.some(
      (entry) => !SAFE_REPO_DIGEST.test(entry),
    ) ||
    diagnostic.observed_runtime.repoDigests.join('\n') !==
      sortedUnique(diagnostic.observed_runtime.repoDigests).join('\n')
  ) {
    throw new Error('Local container identity diagnostic is invalid')
  }
  return diagnostic
}

export class LocalContainerImageIdentityRejection extends Error {
  constructor(role, diagnostic) {
    super(FAILURE_MESSAGES[diagnostic?.failure_stage] ?? 'Identity rejected')
    if (!ROLES.has(role))
      throw new Error('Local container identity diagnostic role is invalid')
    this.name = 'LocalContainerImageIdentityRejection'
    this.role = role
    this.identityDiagnostic = validateDiagnostic(diagnostic)
  }
}

function rejectionEvidence(error, commitSha) {
  if (
    !(error instanceof LocalContainerImageIdentityRejection) ||
    !COMMIT_SHA.test(commitSha ?? '')
  ) {
    throw new Error('Local container identity rejection evidence is invalid')
  }
  return {
    schemaVersion: 1,
    status: 'local_container_image_identity_rejected',
    commitSha,
    role: error.role,
    ...error.identityDiagnostic,
  }
}

export function serializeLocalContainerIdentityRejection(error, commitSha) {
  return `${JSON.stringify(rejectionEvidence(error, commitSha))}\n`
}

export function emitLocalContainerIdentityRejection(
  error,
  commitSha,
  { cwd = process.cwd(), write = (value) => process.stdout.write(value) } = {},
) {
  const line = serializeLocalContainerIdentityRejection(error, commitSha)
  const evidenceDirectory = path.join(cwd, '.ci-evidence')
  mkdirSync(evidenceDirectory, { recursive: true })
  writeFileSync(
    path.join(
      evidenceDirectory,
      'local-container-image-identity-rejected.json',
    ),
    line,
    { encoding: 'utf8', flag: 'wx', mode: 0o600 },
  )
  write(line)
  return line
}

export function parseLocalContainerIdentityRejection(output) {
  const matches = String(output ?? '')
    .split(/\r?\n/u)
    .filter((line) => line.includes('local_container_image_identity_rejected'))
  if (matches.length === 0) return null
  if (matches.length !== 1 || matches[0].length > 4096) {
    throw new Error('Local container identity rejection log is ambiguous')
  }
  let evidence
  try {
    evidence = JSON.parse(matches[0])
  } catch {
    throw new Error('Local container identity rejection log is invalid')
  }
  if (
    !exactKeys(evidence, EVIDENCE_KEYS) ||
    evidence.schemaVersion !== 1 ||
    evidence.status !== 'local_container_image_identity_rejected' ||
    !COMMIT_SHA.test(evidence.commitSha ?? '') ||
    !ROLES.has(evidence.role) ||
    JSON.stringify(evidence) !== matches[0]
  ) {
    throw new Error('Local container identity rejection evidence is invalid')
  }
  validateDiagnostic(
    Object.fromEntries(DIAGNOSTIC_KEYS.map((key) => [key, evidence[key]])),
  )
  return evidence
}
