import { spawn, spawnSync } from 'node:child_process'
import {
  chmod,
  mkdir,
  mkdtemp,
  rename,
  realpath,
  readdir,
  rm,
  rmdir,
  stat,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { postgresUrlToLibpqEnv } from './critical-backup-contract.mjs'

const PROCESS_TIMEOUT_MS = 600_000
const RESTORE_DATABASE = 'capital_lab_restore'

function fail(message) {
  throw new Error(message)
}

function git(args, cwd) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  })
  if (result.status !== 0) fail('Git evidence could not be derived')
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

async function run(command, args, phase, env = process.env) {
  return new Promise((resolve, reject) => {
    let settled = false
    const child = spawn(command, args, {
      env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore'],
    })
    const timer = setTimeout(() => child.kill('SIGTERM'), PROCESS_TIMEOUT_MS)
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
      if (code !== 0 || signal)
        reject(new Error(`Local database preparation failed: ${phase}`))
      else resolve()
    })
  })
}

async function main() {
  if (process.argv.length !== 2) {
    fail('This local target-preparation command accepts no arguments')
  }
  const workspace = await realpath(process.cwd())
  if (git(['status', '--porcelain=v1', '--untracked-files=all'], workspace)) {
    fail('Local target preparation requires a completely clean Working Tree')
  }
  const connectionValue = process.env.CAPITAL_LAB_DATABASE_URL
  if (!connectionValue)
    fail('CAPITAL_LAB_DATABASE_URL is required and never printed')
  const source = postgresUrlToLibpqEnv(connectionValue, { localOnly: true })
  if (source.database !== 'postgres') {
    fail('Local source database must be exactly postgres')
  }

  const migrations = path.join(workspace, 'supabase', 'migrations')
  const heldMigrations = path.join(
    workspace,
    'supabase',
    '.migration-restore-hold',
  )
  if (await exists(heldMigrations)) fail('Migration hold path already exists')
  const migrationNames = (await readdir(migrations)).sort()
  if (
    migrationNames.length === 0 ||
    migrationNames.some((name) => !/^\d{14}_[a-z0-9_]+\.sql$/u.test(name))
  ) {
    fail('Migration directory contains an unexpected entry')
  }

  const supabase = process.platform === 'win32' ? 'supabase.cmd' : 'supabase'
  await mkdir(heldMigrations)
  for (const name of migrationNames) {
    await rename(path.join(migrations, name), path.join(heldMigrations, name))
  }
  try {
    await run(supabase, ['db', 'reset', '--no-seed'], 'baseline_reset')
  } finally {
    for (const name of migrationNames) {
      await rename(path.join(heldMigrations, name), path.join(migrations, name))
    }
    await rmdir(heldMigrations)
  }
  if (git(['status', '--porcelain=v1', '--untracked-files=all'], workspace)) {
    fail('Migration files were not restored byte-for-byte')
  }

  const psql = process.platform === 'win32' ? 'psql.exe' : 'psql'
  const pgDump = process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump'
  const commonEnv = {
    ...process.env,
    ...source.libpqEnv,
    PGCONNECT_TIMEOUT: '10',
    PGDATABASE: 'template1',
    PGOPTIONS: '-c statement_timeout=300000 -c lock_timeout=10000',
  }
  const psqlArgs = ['-X', '--no-psqlrc', '--set', 'ON_ERROR_STOP=1']
  const sql = async (statement, phase, env = commonEnv) =>
    run(psql, [...psqlArgs, '--command', statement], phase, env)

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
  const sourceEnv = { ...commonEnv, PGDATABASE: 'postgres' }
  const targetEnv = { ...commonEnv, PGDATABASE: RESTORE_DATABASE }
  try {
    await run(
      pgDump,
      ['--schema-only', '--file', baselineSchema],
      'platform_schema_dump',
      sourceEnv,
    )
    await run(
      pgDump,
      ['--data-only', '--file', baselineData],
      'platform_data_dump',
      sourceEnv,
    )
    await chmod(baselineSchema, 0o600)
    await chmod(baselineData, 0o600)
    await run(
      psql,
      [...psqlArgs, '--single-transaction', '--file', baselineSchema],
      'platform_schema_restore',
      targetEnv,
    )
    await run(
      psql,
      [
        ...psqlArgs,
        '--single-transaction',
        '--command',
        'SET session_replication_role = replica',
        '--file',
        baselineData,
      ],
      'platform_data_restore',
      targetEnv,
    )
  } finally {
    await rm(baselineDirectory, { recursive: true, force: true })
  }

  await sql(
    'drop schema if exists supabase_migrations cascade',
    'history_clear',
    targetEnv,
  )
  process.stdout.write(
    `${JSON.stringify({ status: 'seed_free_supabase_baseline_created' })}\n`,
  )
}

await main()
