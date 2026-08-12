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
import { validateSchemaGoldenReferenceProof } from './lib/schema-golden-reference-proof.mjs'
import { loadSchemaGoldenBootstrapContract } from './lib/schema-golden-bootstrap-contract.mjs'
import {
  resolvedArguments,
  resolveNativeExecutable,
} from './lib/safe-process.mjs'
import {
  newExternalPath,
  verifyCreatedExternalPath,
  verifiedExternalFile,
} from './lib/safe-artifact-path.mjs'

const CONFIRMATION = 'UPDATE REVIEWED CAPITAL LAB SCHEMA GOLDEN'

export function parseSchemaGoldenCaptureOptions(argv) {
  const entries = argv.map((argument) => {
    const match =
      /^--(confirm|contract|expected-reference-proof-sha256|output|reference-proof)=(.+)$/u.exec(
        argument,
      )
    if (!match) throw new Error('Schema-golden arguments are invalid')
    return [match[1], match[2]]
  })
  const parsed = Object.fromEntries(entries)
  if (
    entries.length !== 5 ||
    new Set(entries.map(([key]) => key)).size !== 5 ||
    !['pre', 'post'].includes(parsed.contract) ||
    parsed.confirm !== CONFIRMATION ||
    !/^[0-9a-f]{64}$/u.test(parsed['expected-reference-proof-sha256'] ?? '')
  ) {
    throw new Error(
      'Explicit --contract, --output, --reference-proof, retained proof hash, and reviewed confirmation are required',
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
    throw new Error('Git evidence could not be derived')
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
            `Schema-golden capture failed; redacted error: ${redactedPostgresError(stderr)}`,
          ),
        )
      } else resolve(JSON.parse(stdout.trim()))
    })
    child.stdin.end(sql)
  })
}

async function main() {
  const requested = parseSchemaGoldenCaptureOptions(process.argv.slice(2))
  const workspace = await realpath(process.cwd())
  if (git(['status', '--porcelain=v1', '--untracked-files=all'], workspace)) {
    throw new Error('Schema-golden capture requires a clean Working Tree')
  }
  const output = await newExternalPath(workspace, requested.output)
  const databaseUrl = process.env.CAPITAL_LAB_REFERENCE_DATABASE_URL
  const peerReferenceDatabaseUrl =
    process.env.CAPITAL_LAB_GOLDEN_PEER_REFERENCE_DATABASE_URL
  if (!databaseUrl || !peerReferenceDatabaseUrl)
    throw new Error(
      'Two distinct Reference database URLs are required and never printed',
    )
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
  const referenceConnection = postgresUrlToLibpqEnv(databaseUrl, {
    localOnly: true,
  })
  const peerReferenceConnection = postgresUrlToLibpqEnv(
    peerReferenceDatabaseUrl,
    {
      localOnly: true,
    },
  )
  const actual = await evidence(
    referenceConnection.libpqEnv,
    buildSchemaGoldenEvidenceSql(contract),
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
      )
  ) {
    throw new Error('Schema-golden source migration history differs')
  }
  const referenceProofPath = await verifiedExternalFile(
    workspace,
    requested['reference-proof'],
  )
  const referenceProofBytes = await readFile(referenceProofPath)
  if (
    sha256(referenceProofBytes) !== requested['expected-reference-proof-sha256']
  ) {
    throw new Error(
      'Schema-golden reference proof differs from its retained hash',
    )
  }
  let referenceProof
  try {
    referenceProof = JSON.parse(referenceProofBytes.toString('utf8'))
  } catch {
    throw new Error('Schema-golden reference proof is invalid JSON')
  }
  const referenceIdentity = await evidence(
    referenceConnection.libpqEnv,
    buildServerIdentitySql(),
  )
  const peerReferenceIdentity = await evidence(
    peerReferenceConnection.libpqEnv,
    buildServerIdentitySql(),
  )
  const { contract: bootstrapContract, sha256: bootstrapContractSha256 } =
    await loadSchemaGoldenBootstrapContract(workspace)
  validateSchemaGoldenReferenceProof(
    referenceProof,
    {
      contractKind,
      gitCommitSha: git(['rev-parse', 'HEAD'], workspace),
      relationContractSha256,
      migrationHistorySha256: actual.migrationHistorySha256,
      bootstrapContract,
      bootstrapContractSha256,
      sha256,
    },
    referenceIdentity,
    peerReferenceIdentity,
  )
  if (
    referenceProof.hostname !== referenceConnection.hostname ||
    referenceProof.port !== referenceConnection.port ||
    referenceProof.database !== referenceConnection.database
  ) {
    throw new Error('Schema-golden reference proof target changed')
  }
  const golden = {
    contractKind,
    migrationHistorySha256: actual.migrationHistorySha256,
    relationContractSha256,
    relationSetSha256: actual.relationSetSha256,
    schemaEvidence: actual.schemaEvidence,
    schemaEvidenceSha256: sha256(canonicalJson(actual.schemaEvidence)),
    schemaFingerprintSha256: actual.schemaFingerprintSha256,
    schemaFingerprintVersion: 'capital-lab-schema-fingerprint-v2',
    schemaVersion: 1,
  }
  const bytes = Buffer.from(`${canonicalJson(golden)}\n`)
  await writeFile(output, bytes, { mode: 0o600, flag: 'wx' })
  await chmod(output, 0o600)
  await verifyCreatedExternalPath(workspace, output)
  process.stdout.write(
    `${JSON.stringify({ status: 'schema_golden_captured', contractKind, outputContainsRowData: false })}\n`,
  )
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main().catch((error) => {
    console.error(
      error instanceof Error
        ? error.message
        : 'Schema-golden capture failed closed',
    )
    process.exit(1)
  })
}
