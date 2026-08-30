import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  canonicalJson,
  loadCriticalRelationContract,
  sha256,
} from './critical-backup-contract.mjs'
import { canonicalRepositoryTextBytes } from './lib/canonical-repository-bytes.mjs'
import { inspectOwnedDatabaseContainer } from './lib/local-container-postgres.mjs'
import { parseLocalContainerIdentityRejection } from './lib/local-container-identity-diagnostic.mjs'
import {
  buildSchemaGoldenReferenceMigrationReplayFailureObservation,
  buildSchemaGoldenReferenceMigrationReplayObservation,
  parseLocalMigrationReplayOutcome,
  requireLocalMigrationReplayDiagnostic,
  serializeSchemaGoldenReferenceMigrationReplayFailureObservation,
  serializeSchemaGoldenReferenceMigrationReplayObservation,
} from './lib/local-migration-replay-diagnostic.mjs'
import {
  canonicalReferenceProjectId,
  canonicalReferenceRunId,
  localCiImageIdentityEvidence,
} from './lib/owned-local-ci-stack.mjs'
import {
  diagnosticFromStructuredOutput,
  validateRedactedSupabaseDiagnostic,
} from './lib/redacted-supabase-diagnostic.mjs'
import { loadSchemaGoldenBootstrapContract } from './lib/schema-golden-bootstrap-contract.mjs'
import {
  newExternalPath,
  verifyCreatedExternalPath,
} from './lib/safe-artifact-path.mjs'
import {
  resolvedArguments,
  resolveNativeExecutable,
} from './lib/safe-process.mjs'

const PROCESS_TIMEOUT_MS = 12 * 60 * 1000
const CONFIRMATION = 'BUILD REVIEWED SEED FREE SCHEMA GOLDENS'
const RUN_ID = /^run-[a-z0-9][a-z0-9-]{4,27}$/u
const SHA = /^[0-9a-f]{40}$/u

export function parseSchemaGoldenBootstrapOptions(argv) {
  const entries = argv.map((argument) => {
    const match =
      /^--(confirm|expected-commit-sha|output-dir|run-id)=(.+)$/u.exec(argument)
    if (!match) throw new Error('Schema-golden bootstrap arguments are invalid')
    return [match[1], match[2]]
  })
  const parsed = Object.fromEntries(entries)
  if (
    entries.length !== 4 ||
    new Set(entries.map(([key]) => key)).size !== 4 ||
    parsed.confirm !== CONFIRMATION ||
    !SHA.test(parsed['expected-commit-sha'] ?? '') ||
    !RUN_ID.test(parsed['run-id'] ?? '')
  ) {
    throw new Error(
      'Exact commit, run ID, new output directory, and reviewed confirmation are required',
    )
  }
  return parsed
}

function git(args, cwd) {
  const executable = resolveNativeExecutable('git')
  const result = spawnSync(
    executable.command,
    resolvedArguments(executable, args),
    { cwd, encoding: 'utf8', shell: false, windowsHide: true },
  )
  if (result.status !== 0 || result.signal || result.error) {
    throw new Error('Schema-golden bootstrap Git evidence could not be derived')
  }
  return result.stdout.trim()
}

async function runProcess(command, args, options = {}) {
  const executable = resolveNativeExecutable(command)
  return new Promise((resolve, reject) => {
    let stdout = Buffer.alloc(0)
    let stderr = Buffer.alloc(0)
    let settled = false
    let timedOut = false
    let forceTimer
    const child = spawn(
      executable.command,
      resolvedArguments(executable, args),
      {
        cwd: options.cwd,
        env: options.env ?? process.env,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    const append = (current, chunk) =>
      Buffer.concat([current, Buffer.from(chunk)]).subarray(-1024 * 1024)
    child.stdout.on('data', (chunk) => (stdout = append(stdout, chunk)))
    child.stderr.on('data', (chunk) => (stderr = append(stderr, chunk)))
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      forceTimer = setTimeout(() => child.kill('SIGKILL'), 5_000)
    }, options.timeoutMs ?? PROCESS_TIMEOUT_MS)
    child.once('error', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(forceTimer)
      reject(new Error('Allowlisted subprocess could not be spawned'))
    })
    child.once('close', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(forceTimer)
      resolve({ code, signal, timedOut, stdout, stderr })
    })
  })
}

function requireSuccess(outcome, label) {
  if (outcome.code !== 0 || outcome.signal || outcome.timedOut) {
    const identityRejection = parseLocalContainerIdentityRejection(
      outcome.stdout,
    )
    if (identityRejection) {
      process.stdout.write(`${JSON.stringify(identityRejection)}\n`)
    }
    throw new Error(`${label} failed closed`)
  }
  return outcome
}

export function bootstrapFailureDiagnostic(value) {
  let diagnostic
  try {
    diagnostic = validateRedactedSupabaseDiagnostic(value)
  } catch {
    return null
  }
  if (
    diagnostic.failure_category === null ||
    (diagnostic.exit_code === 0 &&
      diagnostic.timeout === false &&
      diagnostic.signal === null)
  ) {
    return null
  }
  return diagnostic
}

function bootstrapSuccessDiagnostic(value) {
  let diagnostic
  try {
    diagnostic = validateRedactedSupabaseDiagnostic(value)
  } catch {
    return null
  }
  return diagnostic.failure_category === null &&
    diagnostic.container_or_service === null &&
    diagnostic.migration_basename === null &&
    diagnostic.sqlstate === null &&
    diagnostic.timeout === false &&
    diagnostic.signal === null &&
    diagnostic.exit_code === 0
    ? diagnostic
    : null
}

export function referenceStartFailureDiagnostic(outcome, diagnostic) {
  const outerFailed =
    outcome?.code !== 0 ||
    Boolean(outcome?.signal) ||
    outcome?.timedOut === true
  const childSuccess = bootstrapSuccessDiagnostic(diagnostic)
  if (!outerFailed && childSuccess) return null

  return (
    bootstrapFailureDiagnostic(diagnostic) ?? {
      failure_category: 'unknown_redacted_failure',
      container_or_service: null,
      migration_basename: null,
      sqlstate: null,
      timeout: outcome?.timedOut === true,
      signal:
        typeof outcome?.signal === 'string' &&
        /^[A-Z][A-Z0-9]{0,15}$/u.test(outcome.signal)
          ? outcome.signal
          : null,
      exit_code: Number.isInteger(outcome?.code) ? outcome.code : null,
    }
  )
}

export function propagateBootstrapFailureDiagnostic(
  error,
  { write = (value) => process.stdout.write(value) } = {},
) {
  const diagnostic = bootstrapFailureDiagnostic(error?.diagnostic)
  if (!diagnostic) return null
  write(`${JSON.stringify(diagnostic)}\n`)
  return diagnostic
}

export async function runBootstrapClosure(
  execute,
  cleanup,
  { write = (value) => process.stdout.write(value) } = {},
) {
  try {
    return await execute()
  } catch (error) {
    propagateBootstrapFailureDiagnostic(error, { write })
    throw error
  } finally {
    await cleanup()
  }
}

export function referencePortPlan(runId) {
  if (!RUN_ID.test(runId)) throw new Error('Reference run ID is invalid')
  const digest = createHash('sha256').update(runId).digest()
  const base = 56_000 + (digest.readUInt16BE(0) % 170) * 20
  const builds = [
    ['pre', 'a'],
    ['pre', 'b'],
    ['post', 'a'],
    ['post', 'b'],
  ].map(([contract, replica], index) => ({
    api: base + index * 4,
    db: base + index * 4 + 1,
    shadow: base + index * 4 + 2,
    studio: base + index * 4 + 3,
    contract,
    replica,
  }))
  const ports = builds.flatMap(({ api, db, shadow, studio }) => [
    api,
    db,
    shadow,
    studio,
  ])
  if (
    new Set(ports).size !== ports.length ||
    ports.some((port) => port < 56_000 || port > 59_999)
  ) {
    throw new Error('Reference port plan is not unique and bounded')
  }
  return builds
}

export function referenceConfig(projectId, ports) {
  if (!/^capital-lab-ref-(?:pre|post)-(?:a|b)-[0-9a-f]{16}$/u.test(projectId)) {
    throw new Error('Reference project identity is invalid')
  }
  return `project_id = "${projectId}"

[api]
enabled = false
port = ${ports.api}
schemas = ["public", "graphql_public"]
extra_search_path = ["public", "extensions"]
max_rows = 1000

[db]
port = ${ports.db}
shadow_port = ${ports.shadow}
major_version = 17

[db.migrations]
enabled = false
schema_paths = []

[db.seed]
enabled = false
sql_paths = []

[studio]
enabled = false
port = ${ports.studio}

[auth]
enabled = false
site_url = "http://127.0.0.1:3000"
enable_signup = false
enable_anonymous_sign_ins = false

[realtime]
enabled = false

[storage]
enabled = true
file_size_limit = "25MiB"

[edge_runtime]
enabled = false

[analytics]
enabled = false

[inbucket]
enabled = false
`
}

async function verifiedMigrationInputs(workspace, short, contract) {
  const migrationDirectory = path.join(workspace, 'supabase', 'migrations')
  const rows = []
  for (const migration of contract.migrations) {
    const filename = path.join(migrationDirectory, migration.name)
    const bytes = await readFile(filename)
    const canonical = canonicalRepositoryTextBytes(bytes)
    if (sha256(canonical) !== migration.sha256) {
      throw new Error(
        `${short.toUpperCase()} migration bytes differ from contract`,
      )
    }
    rows.push({
      name: migration.name,
      bytes,
      rawSha256: sha256(bytes),
    })
  }
  return rows
}

async function createReferenceWorkdir(root, build, runId, migrations) {
  const referenceRunId = canonicalReferenceRunId(
    runId,
    build.contract,
    build.replica,
  )
  const projectId = canonicalReferenceProjectId(referenceRunId)
  const directory = path.join(root, `${build.contract}-${build.replica}`)
  const migrationDirectory = path.join(directory, 'supabase', 'migrations')
  await mkdir(migrationDirectory, { recursive: true, mode: 0o700 })
  await writeFile(
    path.join(directory, 'supabase', 'config.toml'),
    referenceConfig(projectId, build),
    { mode: 0o600, flag: 'wx' },
  )
  for (const migration of migrations) {
    await writeFile(
      path.join(migrationDirectory, migration.name),
      migration.bytes,
      { mode: 0o600, flag: 'wx' },
    )
  }
  return {
    ...build,
    directory,
    projectId,
    referenceRunId,
    databaseUrl: `postgresql://postgres:postgres@127.0.0.1:${build.db}/postgres`,
  }
}

export function referenceStartArguments(build, workspace) {
  if (
    !['pre', 'post'].includes(build?.contract) ||
    !['a', 'b'].includes(build?.replica) ||
    typeof build?.directory !== 'string' ||
    !path.isAbsolute(build.directory) ||
    typeof workspace !== 'string' ||
    !path.isAbsolute(workspace)
  ) {
    throw new Error('Reference Supabase start identity is invalid')
  }
  return [
    path.join(workspace, 'scripts', 'run-redacted-subprocess.mjs'),
    `--id=golden-${build.contract}-${build.replica}-start`,
    '--role=reference',
    '--',
    'supabase',
    'start',
    `--workdir=${build.directory}`,
    '--exclude=storage-api',
  ]
}

async function startReference(build, workspace) {
  const outcome = await runProcess(
    'node',
    referenceStartArguments(build, workspace),
    {
      cwd: workspace,
      env: {
        ...process.env,
        CAPITAL_LAB_REFERENCE_DATABASE_PORT: String(build.db),
        CAPITAL_LAB_REFERENCE_RUN_ID: build.referenceRunId,
      },
    },
  )
  const diagnostic = diagnosticFromStructuredOutput(
    outcome.stdout.toString('utf8'),
  )
  const failureDiagnostic = referenceStartFailureDiagnostic(outcome, diagnostic)
  if (failureDiagnostic) {
    const error = new Error(
      'Reference Supabase start failed with redacted evidence',
    )
    error.diagnostic = failureDiagnostic
    throw error
  }
  return diagnostic
}

async function createReferenceNetwork(build, workspace) {
  return runProcess(
    'node',
    [
      path.join(
        workspace,
        'scripts',
        'create-owned-local-supabase-network.mjs',
      ),
      '--role=reference',
    ],
    {
      cwd: workspace,
      env: {
        ...process.env,
        CAPITAL_LAB_REFERENCE_DATABASE_PORT: String(build.db),
        CAPITAL_LAB_REFERENCE_RUN_ID: build.referenceRunId,
      },
    },
  )
}

async function stopReference(build, workspace) {
  return runProcess(
    'node',
    [
      path.join(workspace, 'scripts', 'cleanup-owned-local-supabase-stack.mjs'),
      '--role=reference',
      `--workdir=${build.directory}`,
    ],
    {
      timeoutMs: 180_000,
      cwd: workspace,
      env: {
        ...process.env,
        CAPITAL_LAB_REFERENCE_DATABASE_PORT: String(build.db),
        CAPITAL_LAB_REFERENCE_RUN_ID: build.referenceRunId,
      },
    },
  )
}

async function applyReferenceMigrations(build, workspace, migrationBasenames) {
  const outcome = await runProcess(
    'node',
    [
      path.join(workspace, 'scripts', 'apply-local-migrations-via-psql.mjs'),
      `--contract=${build.contract}`,
      '--seed=omit',
      '--target=reference',
    ],
    {
      cwd: workspace,
      env: {
        ...process.env,
        CAPITAL_LAB_REFERENCE_DATABASE_PORT: String(build.db),
        CAPITAL_LAB_REFERENCE_RUN_ID: build.referenceRunId,
      },
    },
  )
  const identityRejection = parseLocalContainerIdentityRejection(outcome.stdout)
  if (identityRejection) {
    process.stdout.write(`${JSON.stringify(identityRejection)}\n`)
    throw new Error('Reference migration replay failed closed')
  }
  propagateLocalMigrationReplayOutcome(outcome, build, migrationBasenames)
  if (outcome.code !== 0 || outcome.signal || outcome.timedOut) {
    throw new Error('Reference migration replay failed closed')
  }
}

export function propagateLocalMigrationReplayOutcome(
  outcome,
  expected,
  migrationBasenames,
  { write = (value) => process.stdout.write(value) } = {},
) {
  if (
    outcome === null ||
    typeof outcome !== 'object' ||
    Array.isArray(outcome) ||
    !Object.hasOwn(outcome, 'code') ||
    !Object.hasOwn(outcome, 'signal') ||
    !Object.hasOwn(outcome, 'timedOut') ||
    !Object.hasOwn(outcome, 'stdout')
  ) {
    throw new Error('Reference migration replay outcome is invalid')
  }
  const completed =
    outcome.code === 0 && outcome.signal === null && outcome.timedOut === false
  const failed =
    (Number.isInteger(outcome.code) && outcome.code !== 0) ||
    typeof outcome.signal === 'string' ||
    outcome.timedOut === true
  if (!completed && !failed) {
    throw new Error('Reference migration replay outcome is invalid')
  }
  const parsed = parseLocalMigrationReplayOutcome(
    outcome.stdout,
    migrationBasenames,
  )
  for (const diagnostic of [parsed.boundary, parsed.failure].filter(Boolean)) {
    if (
      diagnostic.role !== 'reference' ||
      diagnostic.contract !== expected.contract
    ) {
      throw new Error(
        'Reference migration replay diagnostic context is invalid',
      )
    }
  }
  if (
    (completed && (!parsed.boundary || parsed.failure)) ||
    (failed && !parsed.failure)
  ) {
    throw new Error('Reference migration replay outcome is invalid')
  }
  const observation = parsed.boundary
    ? buildSchemaGoldenReferenceMigrationReplayObservation({
        contract: expected.contract,
        diagnostic: parsed.boundary,
        replica: expected.replica,
      })
    : null
  const failureObservation = parsed.failure
    ? buildSchemaGoldenReferenceMigrationReplayFailureObservation({
        contract: expected.contract,
        diagnostic: parsed.failure,
        migrationBasenames,
        replica: expected.replica,
      })
    : null
  if (observation) {
    write(serializeSchemaGoldenReferenceMigrationReplayObservation(observation))
  }
  if (failureObservation) {
    write(
      serializeSchemaGoldenReferenceMigrationReplayFailureObservation(
        failureObservation,
        migrationBasenames,
      ),
    )
  }
  return { observation, failureObservation }
}

export function propagateLocalMigrationReplayDiagnostic(
  output,
  expected,
  {
    identityRejected = false,
    write = (value) => process.stdout.write(value),
  } = {},
) {
  if (identityRejected) return null
  const diagnostic = requireLocalMigrationReplayDiagnostic(output)
  if (
    diagnostic.role !== 'reference' ||
    diagnostic.contract !== expected.contract
  ) {
    throw new Error('Reference migration replay diagnostic context is invalid')
  }
  const observation = buildSchemaGoldenReferenceMigrationReplayObservation({
    contract: expected.contract,
    diagnostic,
    replica: expected.replica,
  })
  write(serializeSchemaGoldenReferenceMigrationReplayObservation(observation))
  return observation
}

function verifyReferenceImageIdentity(build) {
  const target = inspectOwnedDatabaseContainer('reference', {
    ...process.env,
    CAPITAL_LAB_REFERENCE_DATABASE_PORT: String(build.db),
    CAPITAL_LAB_REFERENCE_RUN_ID: build.referenceRunId,
  })
  process.stdout.write(
    `${JSON.stringify({ status: 'local_container_image_identity_verified', role: 'reference', runId: build.referenceRunId, ...localCiImageIdentityEvidence(target.identity) })}\n`,
  )
  return target.identity
}

async function prepareProof(build, workspace, proofPath) {
  requireSuccess(
    await runProcess(
      'node',
      [
        path.join(
          workspace,
          'scripts',
          'prepare-schema-golden-reference-proof.mjs',
        ),
        `--contract=${build.contract}`,
        `--proof=${proofPath}`,
      ],
      {
        cwd: workspace,
        env: {
          ...process.env,
          CAPITAL_LAB_REFERENCE_DATABASE_PORT: String(build.db),
          CAPITAL_LAB_REFERENCE_RUN_ID: build.referenceRunId,
        },
      },
    ),
    'Reference proof',
  )
  return JSON.parse((await readFile(proofPath)).toString('utf8'))
}

async function captureGolden(build, peer, workspace, proofPath, outputPath) {
  const proofBytes = await readFile(proofPath)
  requireSuccess(
    await runProcess(
      'node',
      [
        path.join(workspace, 'scripts', 'capture-backup-schema-golden.mjs'),
        `--contract=${build.contract}`,
        `--confirm=UPDATE REVIEWED CAPITAL LAB SCHEMA GOLDEN`,
        `--expected-reference-proof-sha256=${sha256(proofBytes)}`,
        `--output=${outputPath}`,
        `--reference-proof=${proofPath}`,
      ],
      {
        cwd: workspace,
        env: {
          ...process.env,
          CAPITAL_LAB_PEER_REFERENCE_DATABASE_PORT: String(peer.db),
          CAPITAL_LAB_PEER_REFERENCE_RUN_ID: peer.referenceRunId,
          CAPITAL_LAB_REFERENCE_DATABASE_PORT: String(build.db),
          CAPITAL_LAB_REFERENCE_RUN_ID: build.referenceRunId,
        },
      },
    ),
    'Schema-golden capture',
  )
  return readFile(outputPath)
}

export function assertReproducibleGolden(first, second, contract) {
  if (!Buffer.from(first).equals(Buffer.from(second))) {
    throw new Error(
      `${contract.toUpperCase()} schema Golden is not reproducible`,
    )
  }
  return Buffer.from(first)
}

function migrationSetSha256(contract) {
  return sha256(canonicalJson(contract.migrations))
}

export function buildBootstrapProvenance(input) {
  const provenance = {
    schemaVersion: 1,
    contractVersion: input.bootstrapContract.contractVersion,
    gitCommitSha: input.gitCommitSha,
    supabaseCliVersion: input.bootstrapContract.supabaseCliVersion,
    postgresImageRegistry: input.bootstrapContract.postgresImageRegistry,
    postgresImage: input.bootstrapContract.postgresImage,
    postgresImageArchitecture:
      input.bootstrapContract.postgresImageArchitecture,
    postgresImageId: input.bootstrapContract.postgresImageId,
    postgresImageOs: input.bootstrapContract.postgresImageOs,
    postgresImageRepoDigest: input.bootstrapContract.postgresImageRepoDigest,
    postgresProvenanceImage: input.bootstrapContract.postgresProvenanceImage,
    bootstrapContractSha256: input.bootstrapContractSha256,
    outputContainsRowData: false,
    contracts: input.contracts.map((entry) => ({
      contractKind: entry.contractKind,
      relationContractVersion: entry.relationContractVersion,
      relationContractSha256: entry.relationContractSha256,
      migrationSetSha256: entry.migrationSetSha256,
      rawMigrationSetSha256: entry.rawMigrationSetSha256,
      relationSetSha256: entry.golden.relationSetSha256,
      schemaFingerprintSha256: entry.golden.schemaFingerprintSha256,
      schemaEvidenceSha256: entry.golden.schemaEvidenceSha256,
      goldenSha256: entry.goldenSha256,
      builds: entry.builds.map((build) => ({
        clusterId: build.projectId,
        referenceEvidenceSha256: build.evidenceSha256,
        referenceProofSha256: build.referenceProofSha256,
        serverFingerprint: build.serverFingerprint,
        databaseFingerprint: build.databaseFingerprint,
        containerFingerprint: build.containerFingerprint,
        containerImage: build.containerImage,
        containerImageArchitecture: build.containerImageArchitecture,
        containerImageId: build.containerImageId,
        containerImageOs: build.containerImageOs,
        containerImageRepoDigest: build.containerImageRepoDigest,
      })),
    })),
  }
  return {
    ...provenance,
    evidenceSha256: sha256(canonicalJson(provenance)),
  }
}

async function main() {
  const requested = parseSchemaGoldenBootstrapOptions(process.argv.slice(2))
  const workspace = await realpath(process.cwd())
  const actualCommit = git(['rev-parse', 'HEAD'], workspace)
  if (
    actualCommit !== requested['expected-commit-sha'] ||
    git(['status', '--porcelain=v1', '--untracked-files=all'], workspace)
  ) {
    throw new Error('Schema-golden bootstrap requires the exact clean Git HEAD')
  }
  const version = requireSuccess(
    await runProcess('supabase', ['--version'], {
      cwd: workspace,
      timeoutMs: 30_000,
    }),
    'Supabase CLI version check',
  )
    .stdout.toString('utf8')
    .trim()
  const { contract: bootstrapContract, sha256: bootstrapContractSha256 } =
    await loadSchemaGoldenBootstrapContract(workspace)
  if (version !== bootstrapContract.supabaseCliVersion) {
    throw new Error('Schema-golden bootstrap Supabase CLI version differs')
  }
  requireSuccess(
    await runProcess(
      'node',
      [
        path.join(workspace, 'scripts', 'generate-backup-contracts.mjs'),
        '--verify',
      ],
      { cwd: workspace, timeoutMs: 60_000 },
    ),
    'Backup contract byte verification',
  )
  const output = await newExternalPath(workspace, requested['output-dir'])
  await mkdir(output, { mode: 0o700 })
  await chmod(output, 0o700)
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), `capital-lab-golden-${requested['run-id']}-`),
  )
  await chmod(tempRoot, 0o700)
  const marker = sha256(`${actualCommit}:${requested['run-id']}:${tempRoot}`)
  await writeFile(path.join(tempRoot, '.capital-lab-golden-owner'), marker, {
    mode: 0o600,
    flag: 'wx',
  })
  const running = []
  let completed = false
  const execute = async () => {
    const contractInputs = {}
    for (const [short, kind] of [
      ['pre', 'pre_activation'],
      ['post', 'post_activation'],
    ]) {
      const contractPath = path.join(
        workspace,
        'supabase',
        'backup',
        `${short}-activation.v1.json`,
      )
      const loaded = await loadCriticalRelationContract(contractPath, kind)
      contractInputs[short] = {
        ...loaded,
        migrations: await verifiedMigrationInputs(
          workspace,
          short,
          loaded.contract,
        ),
      }
    }
    const plan = referencePortPlan(requested['run-id'])
    const builds = []
    for (const build of plan) {
      builds.push(
        await createReferenceWorkdir(
          tempRoot,
          build,
          requested['run-id'],
          contractInputs[build.contract].migrations,
        ),
      )
    }
    const contractProvenance = []
    for (const short of ['pre', 'post']) {
      const pair = builds.filter((build) => build.contract === short)
      for (const build of pair) {
        requireSuccess(
          await createReferenceNetwork(build, workspace),
          'Reference network creation',
        )
        running.push(build)
        await startReference(build, workspace)
        verifyReferenceImageIdentity(build)
        await applyReferenceMigrations(
          build,
          workspace,
          contractInputs[build.contract].contract.migrations.map(
            ({ name }) => name,
          ),
        )
      }
      const captures = []
      const proofRows = []
      for (let index = 0; index < pair.length; index += 1) {
        const build = pair[index]
        const peer = pair[1 - index]
        const proofPath = path.join(
          tempRoot,
          `${short}-${build.replica}-proof.json`,
        )
        const goldenPath = path.join(
          tempRoot,
          `${short}-${build.replica}-golden.json`,
        )
        const proof = await prepareProof(build, workspace, proofPath)
        const proofBytes = await readFile(proofPath)
        captures.push(
          await captureGolden(build, peer, workspace, proofPath, goldenPath),
        )
        proofRows.push({
          ...proof,
          referenceProofSha256: sha256(proofBytes),
        })
      }
      const goldenBytes = assertReproducibleGolden(
        captures[0],
        captures[1],
        short,
      )
      const filename = `${short}-activation.schema-golden.v2.json`
      await writeFile(path.join(output, filename), goldenBytes, {
        mode: 0o600,
        flag: 'wx',
      })
      const golden = JSON.parse(goldenBytes.toString('utf8'))
      const input = contractInputs[short]
      contractProvenance.push({
        contractKind: golden.contractKind,
        relationContractVersion: input.contract.schemaVersion,
        relationContractSha256: input.sha256,
        migrationSetSha256: migrationSetSha256(input.contract),
        rawMigrationSetSha256: sha256(
          canonicalJson(
            input.migrations.map(({ name, rawSha256 }) => ({
              name,
              rawSha256,
            })),
          ),
        ),
        golden,
        goldenSha256: sha256(goldenBytes),
        builds: proofRows,
      })
      for (const build of [...pair].reverse()) {
        requireSuccess(
          await stopReference(build, workspace),
          'Reference stack cleanup',
        )
        running.splice(running.indexOf(build), 1)
      }
    }
    const provenance = buildBootstrapProvenance({
      bootstrapContract,
      bootstrapContractSha256,
      gitCommitSha: actualCommit,
      contracts: contractProvenance,
    })
    await writeFile(
      path.join(output, 'schema-golden-bootstrap-provenance.v1.json'),
      `${canonicalJson(provenance)}\n`,
      { mode: 0o600, flag: 'wx' },
    )
    await verifyCreatedExternalPath(workspace, output)
    completed = true
    process.stdout.write(
      `${JSON.stringify({ status: 'schema_goldens_reproducible', buildCount: 4, outputContainsRowData: false, preGoldenSha256: contractProvenance[0].goldenSha256, postGoldenSha256: contractProvenance[1].goldenSha256 })}\n`,
    )
  }
  const cleanup = async () => {
    let cleanupFailed = false
    for (const build of [...running].reverse()) {
      try {
        const outcome = await stopReference(build, workspace)
        if (outcome.code !== 0 || outcome.signal || outcome.timedOut)
          cleanupFailed = true
      } catch {
        cleanupFailed = true
      }
    }
    try {
      const actualMarker = await readFile(
        path.join(tempRoot, '.capital-lab-golden-owner'),
        'utf8',
      )
      if (
        actualMarker !== marker ||
        !(await realpath(tempRoot)).startsWith(await realpath(os.tmpdir()))
      ) {
        cleanupFailed = true
      } else {
        await rm(tempRoot, { recursive: true })
      }
    } catch {
      cleanupFailed = true
    }
    if (cleanupFailed)
      throw new Error('Owned Reference stack cleanup failed closed')
    if (!completed) {
      try {
        await verifyCreatedExternalPath(workspace, output)
        await rm(output, { recursive: true })
      } catch {
        throw new Error('Incomplete Golden artifact cleanup failed closed')
      }
    }
  }
  await runBootstrapClosure(execute, cleanup)
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main().catch(() => {
    process.stderr.write('Schema-golden bootstrap failed closed.\n')
    process.exit(1)
  })
}
