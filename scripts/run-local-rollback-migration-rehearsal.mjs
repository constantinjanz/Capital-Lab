import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  postgresUrlToLibpqEnv,
  redactedPostgresError,
} from './critical-backup-contract.mjs'
import { extractRollbackMigrationBody } from './migration-rehearsal-contract.mjs'
import {
  resolvedArguments,
  resolveNativeExecutable,
} from './lib/safe-process.mjs'
import { withHeldFiles } from './lib/held-files.mjs'

const PROCESS_TIMEOUT_MS = 600_000
const MIGRATIONS = Object.freeze([
  '20260809150000_post_build_hosting_safety.sql',
  '20260809150417_activation_readiness_follow_up.sql',
  '20260812092043_fourth_activation_readiness_remediation.sql',
  '20260812140953_fourth_activation_readiness_review_closure.sql',
])
const PROBE_RELATION = 'private.no_ai_shadow_dry_runs'

function fail(message) {
  throw new Error(message)
}

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
  if (result.status !== 0) fail('Git evidence could not be derived')
  return result.stdout.trim()
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
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

async function run(executableName, args, phase, env = process.env) {
  return new Promise((resolve, reject) => {
    let settled = false
    let timedOut = false
    let stdout = ''
    let stderr = ''
    const executable = resolveNativeExecutable(executableName)
    const child = spawn(
      executable.command,
      resolvedArguments(executable, args),
      {
        env,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
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
            `Local rollback rehearsal failed: ${phase}; redacted database error: ${redactedPostgresError(stderr)}`,
          ),
        )
      } else resolve(stdout)
    })
  })
}

async function main() {
  if (process.argv.length !== 2) {
    fail('This local rollback rehearsal accepts no arguments')
  }
  const workspace = await realpath(process.cwd())
  const initialHead = git(['rev-parse', 'HEAD'], workspace)
  if (!/^[0-9a-f]{40}$/u.test(initialHead)) fail('Git HEAD evidence is invalid')
  if (git(['status', '--porcelain=v1', '--untracked-files=all'], workspace)) {
    fail('Local rollback rehearsal requires a completely clean Working Tree')
  }
  const connectionValue = process.env.CAPITAL_LAB_DATABASE_URL
  if (!connectionValue)
    fail('CAPITAL_LAB_DATABASE_URL is required and never printed')
  const connection = postgresUrlToLibpqEnv(connectionValue, { localOnly: true })
  if (connection.database !== 'postgres') {
    fail('Local rehearsal database must be exactly postgres')
  }

  const migrationDirectory = path.join(workspace, 'supabase', 'migrations')
  const holdDirectory = path.join(
    workspace,
    'supabase',
    '.rollback-rehearsal-hold',
  )
  if (await exists(holdDirectory))
    fail('Rollback rehearsal hold path already exists')
  const migrations = await Promise.all(
    MIGRATIONS.map(async (name) => {
      const filename = path.join(migrationDirectory, name)
      const bytes = await readFile(filename)
      return {
        body: extractRollbackMigrationBody(bytes.toString('utf8'), name),
        bytes,
        filename,
        name,
        sha256: sha256(bytes),
      }
    }),
  )

  await withHeldFiles(
    migrations.map((migration) => ({
      name: migration.name,
      source: migration.filename,
    })),
    holdDirectory,
    async () => {
      await run('supabase', ['db', 'reset', '--no-seed'], 'baseline_reset')
    },
  )

  for (const migration of migrations) {
    const restored = await readFile(migration.filename)
    if (sha256(restored) !== migration.sha256) {
      fail(`Migration ${migration.name} was not restored byte-for-byte`)
    }
  }
  if (
    git(['rev-parse', 'HEAD'], workspace) !== initialHead ||
    git(['status', '--porcelain=v1', '--untracked-files=all'], workspace)
  ) {
    fail('Git identity changed during local rollback rehearsal')
  }

  const rehearsalDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'capital-lab-rollback-rehearsal-'),
  )
  const rehearsalFile = path.join(rehearsalDirectory, 'rehearsal.sql')
  const rehearsalSql = `\\set ON_ERROR_STOP on
set statement_timeout = '300s';
set lock_timeout = '10s';
begin;
${migrations.map((migration) => migration.body).join('\n')}
do $rehearsal$
begin
  if to_regclass('${PROBE_RELATION}') is null then
    raise exception 'rollback rehearsal probe relation is missing';
  end if;
end
$rehearsal$;
rollback;
select case
  when to_regclass('${PROBE_RELATION}') is null then 'rollback_verified'
  else 'rollback_failed'
end;
`
  await writeFile(rehearsalFile, rehearsalSql, { mode: 0o600 })
  const psqlEnv = {
    ...process.env,
    ...connection.libpqEnv,
    PGCONNECT_TIMEOUT: '10',
    PGOPTIONS: '-c statement_timeout=300000 -c lock_timeout=10000',
  }
  try {
    const output = await run(
      'psql',
      [
        '-X',
        '--no-psqlrc',
        '--quiet',
        '--tuples-only',
        '--no-align',
        '--file',
        rehearsalFile,
      ],
      'migration_transaction',
      psqlEnv,
    )
    if (output.trim() !== 'rollback_verified') {
      fail('Local rollback rehearsal did not prove a clean rollback')
    }
  } finally {
    await rm(rehearsalDirectory, { recursive: true, force: true })
  }
  process.stdout.write(
    `${JSON.stringify({
      commitSha: initialHead,
      migrationCount: migrations.length,
      migrationSetSha256: sha256(
        migrations
          .map((migration) => `${migration.name}:${migration.sha256}`)
          .join('\n'),
      ),
      status: 'rollback_verified',
    })}\n`,
  )
}

await main()
