import { spawn, spawnSync } from 'node:child_process'
import {
  mkdtemp,
  readFile,
  realpath,
  readdir,
  rm,
  stat,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  postgresUrlToLibpqEnv,
  redactedPostgresError,
} from './critical-backup-contract.mjs'
import {
  resolvedArguments,
  resolveNativeExecutable,
} from './lib/safe-process.mjs'
import { withHeldFiles } from './lib/held-files.mjs'

const PROCESS_TIMEOUT_MS = 600_000
const RESTORE_DATABASE = 'capital_lab_restore'
const DISPOSABLE_CONFIRMATION =
  'CREATE DISPOSABLE CAPITAL LAB RESTORE DATABASE capital_lab_restore'
const PLATFORM_ADMIN = 'supabase_admin'

function git(args, cwd) {
  const executable = resolveNativeExecutable('git')
  const result = spawnSync(
    executable.command,
    resolvedArguments(executable, args),
    {
      cwd,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    },
  )
  if (result.status !== 0 || result.signal || result.error)
    throw new Error('Git evidence could not be derived')
  return result.stdout.trim()
}

async function exists(filename) {
  try {
    await stat(filename)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function run(name, args, phase, env = process.env, input) {
  const executable = resolveNativeExecutable(name)
  return new Promise((resolve, reject) => {
    let settled = false
    let timedOut = false
    let stderr = ''
    const child = spawn(
      executable.command,
      resolvedArguments(executable, args),
      {
        env,
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'ignore', 'pipe'],
      },
    )
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()))
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, PROCESS_TIMEOUT_MS)
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
            `Local database preparation failed: ${phase}; redacted database error: ${redactedPostgresError(stderr)}`,
          ),
        )
      } else resolve()
    })
    child.stdin.end(input)
  })
}

async function main() {
  if (process.argv.length !== 2)
    throw new Error(
      'This local target-preparation command accepts no arguments',
    )
  if (
    process.env.CAPITAL_LAB_LOCAL_DISPOSABLE_CONFIRM !== DISPOSABLE_CONFIRMATION
  ) {
    throw new Error('Exact disposable database confirmation is required')
  }
  const workspace = await realpath(process.cwd())
  if (git(['status', '--porcelain=v1', '--untracked-files=all'], workspace)) {
    throw new Error(
      'Local target preparation requires a completely clean Working Tree',
    )
  }
  const connectionValue = process.env.CAPITAL_LAB_DATABASE_URL
  if (!connectionValue)
    throw new Error('CAPITAL_LAB_DATABASE_URL is required and never printed')
  const source = postgresUrlToLibpqEnv(connectionValue, { localOnly: true })
  if (source.database !== 'postgres')
    throw new Error('Local source database must be exactly postgres')
  const migrations = path.join(workspace, 'supabase', 'migrations')
  const heldMigrations = path.join(
    workspace,
    'supabase',
    '.migration-restore-hold',
  )
  if (await exists(heldMigrations))
    throw new Error('Migration hold path already exists')
  const migrationNames = (await readdir(migrations)).sort()
  if (
    migrationNames.length === 0 ||
    migrationNames.some((name) => !/^\d{14}_[a-z0-9_]+\.sql$/u.test(name))
  ) {
    throw new Error('Migration directory contains an unexpected entry')
  }
  await withHeldFiles(
    migrationNames.map((name) => ({
      name,
      source: path.join(migrations, name),
    })),
    heldMigrations,
    async () => {
      await run('supabase', ['db', 'reset', '--no-seed'], 'baseline_reset')
    },
  )
  if (git(['status', '--porcelain=v1', '--untracked-files=all'], workspace)) {
    throw new Error('Migration files were not restored byte-for-byte')
  }
  const commonEnv = {
    ...process.env,
    ...source.libpqEnv,
    PGCONNECT_TIMEOUT: '10',
    PGDATABASE: 'template1',
    PGOPTIONS: '-c statement_timeout=300000 -c lock_timeout=10000',
  }
  const psqlArgs = ['-X', '--no-psqlrc', '--set', 'ON_ERROR_STOP=1']
  const sql = (statement, phase, env = commonEnv) =>
    run('psql', [...psqlArgs, '--command', statement], phase, env)
  await sql(
    `drop database if exists ${RESTORE_DATABASE} with (force)`,
    'prior_target_drop',
  )
  await sql(
    `create database ${RESTORE_DATABASE} template template0`,
    'target_create',
  )
  const baselineDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'capital-lab-platform-baseline-'),
  )
  const baselineSchema = path.join(baselineDirectory, 'schema.sql')
  const baselineData = path.join(baselineDirectory, 'data.sql')
  const sourceDumpEnv = {
    ...process.env,
    ...source.libpqEnv,
    PGCONNECT_TIMEOUT: '10',
    PGOPTIONS: '-c statement_timeout=300000 -c lock_timeout=10000',
  }
  const targetEnv = { ...commonEnv, PGDATABASE: RESTORE_DATABASE }
  const platformAdminEnv = { ...targetEnv, PGUSER: PLATFORM_ADMIN }
  try {
    await run(
      'pg_dump',
      [
        '--schema-only',
        '--no-owner',
        '--schema',
        'auth',
        '--schema',
        'storage',
        '--file',
        baselineSchema,
      ],
      'platform_schema_dump',
      sourceDumpEnv,
    )
    await run(
      'pg_dump',
      [
        '--data-only',
        '--no-owner',
        '--schema',
        'auth',
        '--schema',
        'storage',
        '--file',
        baselineData,
      ],
      'platform_data_dump',
      sourceDumpEnv,
    )
    await run(
      'psql',
      [...psqlArgs, '--single-transaction', '--file', baselineSchema],
      'platform_schema_restore',
      platformAdminEnv,
    )
    await sql(
      'create schema if not exists extensions authorization supabase_admin',
      'platform_extensions_schema',
      platformAdminEnv,
    )
    await sql(
      'create extension if not exists supabase_vault with schema vault',
      'platform_vault_extension',
      platformAdminEnv,
    )
    await sql(
      'create publication supabase_realtime',
      'platform_realtime_publication',
      targetEnv,
    )
    await run(
      'psql',
      [
        ...psqlArgs,
        '--single-transaction',
        '--command',
        'SET session_replication_role = replica',
        '--file',
        baselineData,
      ],
      'platform_data_restore',
      platformAdminEnv,
    )
  } finally {
    await rm(baselineDirectory, { recursive: true, force: true })
  }
  await sql(
    'drop schema if exists supabase_migrations cascade',
    'history_clear',
    targetEnv,
  )
  const migrationBytes = await Promise.all(
    migrationNames.map((name) => readFile(path.join(migrations, name))),
  )
  if (migrationBytes.some((bytes) => bytes.length === 0)) {
    throw new Error('Migration byte verification failed')
  }
  process.stdout.write(
    `${JSON.stringify({ status: 'seed_free_supabase_baseline_created', database: RESTORE_DATABASE, loopbackOnly: true, migrationFilesRestored: migrationNames.length })}\n`,
  )
}

await main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.message
      : 'Local restore target preparation failed closed',
  )
  process.exit(1)
})
