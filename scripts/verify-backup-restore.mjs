import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const dumpFlag = process.argv.find((argument) => argument.startsWith('--dump='))
const manifestFlag = process.argv.find((argument) =>
  argument.startsWith('--manifest='),
)
if (!dumpFlag || !manifestFlag) {
  throw new Error(
    'Usage: pnpm backup:restore:test -- --dump=<file> --manifest=<file>',
  )
}

const dumpPath = resolve(dumpFlag.slice('--dump='.length))
const manifestPath = resolve(manifestFlag.slice('--manifest='.length))
const databaseValue = process.env.CAPITAL_LAB_RESTORE_DATABASE_URL
if (!databaseValue) {
  throw new Error(
    'CAPITAL_LAB_RESTORE_DATABASE_URL is required and is never printed',
  )
}
const databaseUrl = new URL(databaseValue)
if (!['localhost', '127.0.0.1', '::1'].includes(databaseUrl.hostname)) {
  throw new Error(
    'Restore verification is restricted to a local or disposable test database',
  )
}

const command = process.platform === 'win32' ? 'psql.exe' : 'psql'
async function run(args, capture = false) {
  const exitCode = await new Promise((resolveExit, reject) => {
    const child = spawn(command, args, {
      env: {
        ...process.env,
        PGDATABASE: databaseUrl.toString(),
        PGCONNECT_TIMEOUT: '10',
      },
      stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
      shell: false,
    })
    if (capture) {
      let output = ''
      child.stdout.on('data', (chunk) => {
        output += chunk.toString()
      })
      child.once('exit', (code) => resolveExit({ code: code ?? 1, output }))
    } else {
      child.once('exit', (code) => resolveExit({ code: code ?? 1, output: '' }))
    }
    child.once('error', reject)
  })
  if (exitCode.code !== 0) throw new Error(`psql exited ${exitCode.code}`)
  return exitCode.output
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const actualDumpChecksum = createHash('sha256')
  .update(await readFile(dumpPath))
  .digest('hex')
if (manifest.dumpSha256 !== actualDumpChecksum || !manifest.restoreEvidence) {
  throw new Error('Backup manifest checksum or restore evidence is invalid')
}

const version = spawnSync(command, ['--version'], {
  encoding: 'utf8',
  shell: false,
})
if (version.status !== 0) throw new Error('psql is unavailable')

await run([
  '--set',
  'ON_ERROR_STOP=1',
  '--single-transaction',
  '--file',
  dumpPath,
])
const evidenceOutput = await run(
  [
    '--tuples-only',
    '--no-align',
    '--file',
    resolve('supabase', 'backup', 'critical-restore-evidence.sql'),
  ],
  true,
)
const actualEvidence = JSON.parse(evidenceOutput.trim())
if (
  JSON.stringify(actualEvidence) !== JSON.stringify(manifest.restoreEvidence)
) {
  throw new Error('Restored row counts, checksums, or ledger assertions differ')
}
if (actualEvidence.relations.cash_ledger_entries.duplicate_id_count !== '0') {
  throw new Error('Restored ledger contains duplicate immutable IDs')
}
process.stdout.write(
  '{"status":"local_restore_verified","evidence_match":true,"ledger_duplicate_ids":"0"}\n',
)
