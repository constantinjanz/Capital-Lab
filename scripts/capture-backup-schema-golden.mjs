import { spawn, spawnSync } from 'node:child_process'
import { chmod, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  buildSchemaGoldenEvidenceSql,
  canonicalJson,
  loadCriticalRelationContract,
  postgresUrlToLibpqEnv,
  redactedPostgresError,
} from './critical-backup-contract.mjs'
import {
  resolvedArguments,
  resolveNativeExecutable,
} from './lib/safe-process.mjs'
import { newExternalPath } from './lib/safe-artifact-path.mjs'

const CONFIRMATION = 'UPDATE REVIEWED CAPITAL LAB SCHEMA GOLDEN'

function options() {
  const entries = process.argv.slice(2).map((argument) => {
    const match = /^--(confirm|contract|output)=(.+)$/u.exec(argument)
    if (!match) throw new Error('Schema-golden arguments are invalid')
    return [match[1], match[2]]
  })
  const parsed = Object.fromEntries(entries)
  if (
    entries.length !== 3 ||
    new Set(entries.map(([key]) => key)).size !== 3 ||
    !['pre', 'post'].includes(parsed.contract) ||
    parsed.confirm !== CONFIRMATION
  ) {
    throw new Error(
      'Explicit --contract, --output, and reviewed schema-golden confirmation are required',
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
  const requested = options()
  const workspace = await realpath(process.cwd())
  if (git(['status', '--porcelain=v1', '--untracked-files=all'], workspace)) {
    throw new Error('Schema-golden capture requires a clean Working Tree')
  }
  const output = await newExternalPath(workspace, requested.output)
  const databaseUrl = process.env.CAPITAL_LAB_DATABASE_URL
  if (!databaseUrl)
    throw new Error('Database URL is required and never printed')
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
    postgresUrlToLibpqEnv(databaseUrl).libpqEnv,
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
  const golden = {
    contractKind,
    migrationHistorySha256: actual.migrationHistorySha256,
    relationContractSha256,
    relationSetSha256: actual.relationSetSha256,
    schemaFingerprintSha256: actual.schemaFingerprintSha256,
    schemaFingerprintVersion: 'capital-lab-schema-fingerprint-v2',
    schemaVersion: 1,
  }
  const bytes = Buffer.from(`${canonicalJson(golden)}\n`)
  await writeFile(output, bytes, { mode: 0o600, flag: 'wx' })
  await chmod(output, 0o600)
  process.stdout.write(
    `${JSON.stringify({ status: 'schema_golden_captured', contractKind, outputContainsRowData: false })}\n`,
  )
}

await main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.message
      : 'Schema-golden capture failed closed',
  )
  process.exit(1)
})
