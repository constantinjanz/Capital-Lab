import { spawn } from 'node:child_process'
import { realpath } from 'node:fs/promises'

import {
  postgresUrlToLibpqEnv,
  redactedPostgresError,
} from './critical-backup-contract.mjs'
import {
  loadMvccRaceControl,
  signalMvccMarker,
  waitForMvccMarker,
} from './lib/mvcc-race-control.mjs'
import {
  resolvedArguments,
  resolveNativeExecutable,
} from './lib/safe-process.mjs'

const PROCESS_TIMEOUT_MS = 60_000
const FIXTURE_KEY = 'local_mvcc_race_fixture_v1'

async function query(connection, sql) {
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
        '--quiet',
        '--tuples-only',
        '--no-align',
        '--set',
        'ON_ERROR_STOP=1',
      ]),
      {
        env: {
          ...process.env,
          ...connection.libpqEnv,
          PGCONNECT_TIMEOUT: '10',
          PGOPTIONS: '-c statement_timeout=30000 -c lock_timeout=10000',
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
            `Local MVCC writer failed; redacted error: ${redactedPostgresError(stderr)}`,
          ),
        )
      } else resolve(stdout.trim())
    })
    child.stdin.end(sql)
  })
}

async function main() {
  const workspace = await realpath(process.cwd())
  const control = await loadMvccRaceControl(workspace)
  const databaseUrl = process.env.CAPITAL_LAB_DATABASE_URL
  if (!control || !databaseUrl) {
    throw new Error(
      'Local MVCC writer requires exact control and database input',
    )
  }
  const connection = postgresUrlToLibpqEnv(databaseUrl, { localOnly: true })
  if (
    connection.hostname !== '127.0.0.1' ||
    connection.port !== '54322' ||
    connection.database !== 'postgres'
  ) {
    throw new Error('Local MVCC writer target is not stack A')
  }
  let inserted = false
  try {
    await waitForMvccMarker(control, 'snapshot-ready')
    const insertedCount = await query(
      connection,
      `insert into private.application_settings (owner_id, setting_key, value, is_secret)
select user_id, '${FIXTURE_KEY}', 'false'::jsonb, false
from public.app_users order by user_id limit 1
returning 1;`,
    )
    if (insertedCount !== '1') {
      throw new Error(
        'Local MVCC writer did not insert exactly one fixture row',
      )
    }
    inserted = true
    await signalMvccMarker(workspace, control, 'mutation-visible')
    await waitForMvccMarker(control, 'dumps-complete')
  } finally {
    if (inserted) {
      const deletedCount = await query(
        connection,
        `delete from private.application_settings
where setting_key = '${FIXTURE_KEY}' returning 1;`,
      )
      if (deletedCount !== '1') {
        throw new Error('Local MVCC writer cleanup did not remove its fixture')
      }
      await signalMvccMarker(workspace, control, 'source-restored')
    }
  }
  process.stdout.write(
    `${JSON.stringify({ status: 'local_mvcc_race_completed', sourceRestored: true })}\n`,
  )
}

await main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : 'Local MVCC writer failed closed',
  )
  process.exit(1)
})
