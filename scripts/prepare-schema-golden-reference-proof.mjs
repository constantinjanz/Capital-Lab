import { spawn, spawnSync } from 'node:child_process'
import { chmod, readFile, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  buildSchemaGoldenEvidenceSql,
  buildServerIdentitySql,
  canonicalJson,
  loadCriticalRelationContract,
  postgresUrlToLibpqEnv,
  redactedPostgresError,
  sha256,
} from './critical-backup-contract.mjs'
import { buildSchemaGoldenReferenceProof } from './lib/schema-golden-reference-proof.mjs'
import {
  newExternalPath,
  verifiedExternalFile,
} from './lib/safe-artifact-path.mjs'
import {
  resolvedArguments,
  resolveNativeExecutable,
} from './lib/safe-process.mjs'

function options() {
  const entries = process.argv.slice(2).map((argument) => {
    const match = /^--(contract|proof)=(.+)$/u.exec(argument)
    if (!match) throw new Error('Reference-proof arguments are invalid')
    return [match[1], match[2]]
  })
  const parsed = Object.fromEntries(entries)
  if (
    entries.length !== 2 ||
    new Set(entries.map(([key]) => key)).size !== 2 ||
    !['pre', 'post'].includes(parsed.contract)
  ) {
    throw new Error('Required: --contract=pre|post --proof=<new-external-file>')
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
    throw new Error('Reference-proof Git evidence could not be derived')
  }
  return result.stdout.trim()
}

async function evidence(connectionEnv, sql) {
  const executable = resolveNativeExecutable('psql')
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    const child = spawn(
      executable.command,
      resolvedArguments(executable, [
        '-X',
        '--no-psqlrc',
        '--tuples-only',
        '--no-align',
        '--set',
        'ON_ERROR_STOP=1',
      ]),
      {
        env: {
          ...process.env,
          ...connectionEnv,
          PGCONNECT_TIMEOUT: '10',
          PGOPTIONS: '-c statement_timeout=300000 -c lock_timeout=10000',
        },
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )
    child.stdout.on('data', (chunk) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()))
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, 300_000)
    child.once('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code !== 0 || signal || timedOut) {
        reject(
          new Error(
            `Reference-proof query failed; redacted error: ${redactedPostgresError(stderr)}`,
          ),
        )
      } else resolve(JSON.parse(stdout.trim()))
    })
    child.stdin.end(sql)
  })
}

function inspectContainer(projectId) {
  const executable = resolveNativeExecutable('docker')
  const result = spawnSync(
    executable.command,
    resolvedArguments(executable, ['inspect', `supabase_db_${projectId}`]),
    {
      encoding: 'utf8',
      shell: false,
      timeout: 30_000,
      windowsHide: true,
    },
  )
  if (result.status !== 0 || result.signal || result.error) {
    throw new Error('Reference-cluster container is unavailable')
  }
  const parsed = JSON.parse(result.stdout)
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new Error('Reference-cluster container is not unique')
  }
  return parsed[0]
}

async function main() {
  const requested = options()
  const workspace = await realpath(process.cwd())
  if (git(['status', '--porcelain=v1', '--untracked-files=all'], workspace)) {
    throw new Error('Reference proof requires a clean Working Tree')
  }
  const runId = process.env.CAPITAL_LAB_REFERENCE_RUN_ID
  if (!/^run-[a-z0-9][a-z0-9-]{5,48}$/u.test(runId ?? '')) {
    throw new Error('Run-specific schema reference identity is required')
  }
  const projectId = `capital-lab-reference-${runId}`
  const databaseUrl = process.env.CAPITAL_LAB_REFERENCE_DATABASE_URL
  if (!databaseUrl)
    throw new Error('Reference database URL is required and never printed')
  const connection = postgresUrlToLibpqEnv(databaseUrl, { localOnly: true })
  if (
    connection.hostname !== '127.0.0.1' ||
    !/^5[6-9][0-9]{3}$/u.test(connection.port) ||
    connection.database !== 'postgres'
  ) {
    throw new Error('Schema reference database boundary is invalid')
  }
  const contractKind =
    requested.contract === 'pre' ? 'pre_activation' : 'post_activation'
  const contractPath = path.join(
    workspace,
    'supabase',
    'backup',
    `${requested.contract}-activation.v1.json`,
  )
  const { contract, sha256: relationContractSha256 } =
    await loadCriticalRelationContract(contractPath, contractKind)
  const actual = await evidence(
    connection.libpqEnv,
    buildSchemaGoldenEvidenceSql(contract),
  )
  const seedEvidence = await evidence(
    connection.libpqEnv,
    `select jsonb_build_object(
      'authUsers', (select count(*)::text from auth.users),
      'applicationUsers', (select count(*)::text from public.app_users)
    );`,
  )
  if (
    canonicalJson(actual.catalogRelations) !==
      canonicalJson(contract.relations.map((spec) => spec.relation)) ||
    canonicalJson(actual.appliedMigrations) !==
      canonicalJson(
        contract.migrations.map(({ name, version }) => ({
          name: name.slice(15, -4),
          version,
        })),
      ) ||
    seedEvidence.authUsers !== '0' ||
    seedEvidence.applicationUsers !== '0'
  ) {
    throw new Error('Reference cluster is seeded or not migration-exact')
  }
  const identity = await evidence(connection.libpqEnv, buildServerIdentitySql())
  const inspection = inspectContainer(projectId)
  const portBinding = inspection?.NetworkSettings?.Ports?.['5432/tcp']
  if (
    inspection?.Name !== `/supabase_db_${projectId}` ||
    inspection?.State?.Running !== true ||
    !/^[0-9a-f]{64}$/u.test(inspection?.Id ?? '') ||
    !Array.isArray(portBinding) ||
    portBinding.length !== 1 ||
    portBinding[0]?.HostIp !== '127.0.0.1' ||
    portBinding[0]?.HostPort !== connection.port
  ) {
    throw new Error('Reference cluster container binding is invalid')
  }
  const proof = buildSchemaGoldenReferenceProof({
    contractKind,
    runId,
    projectId,
    hostname: connection.hostname,
    port: connection.port,
    database: connection.database,
    databaseRole: identity.databaseRole,
    gitCommitSha: git(['rev-parse', 'HEAD'], workspace),
    relationContractSha256,
    migrationHistorySha256: actual.migrationHistorySha256,
    serverFingerprint: sha256(identity.serverIdentity),
    databaseFingerprint: sha256(identity.databaseIdentity),
    containerFingerprint: sha256(inspection.Id),
    containerImage: inspection.Config?.Image,
    seedFree: true,
    builtFromReviewedMigrations: true,
    capturedAt: new Date().toISOString(),
  })
  const output = await newExternalPath(workspace, requested.proof)
  const bytes = Buffer.from(`${canonicalJson(proof)}\n`)
  await writeFile(output, bytes, { mode: 0o600, flag: 'wx' })
  await chmod(output, 0o600)
  const verified = await verifiedExternalFile(workspace, output)
  if (!(await readFile(verified)).equals(bytes)) {
    throw new Error('Reference proof write was not durable')
  }
  process.stdout.write(
    `${JSON.stringify({ status: 'schema_golden_reference_proved', contractKind, proofSha256: sha256(bytes) })}\n`,
  )
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : 'Reference proof failed closed',
    )
    process.exit(1)
  })
}
