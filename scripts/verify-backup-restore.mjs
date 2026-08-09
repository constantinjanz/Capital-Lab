import { resolve } from 'node:path'
import { spawn } from 'node:child_process'

const dumpFlag = process.argv.find((argument) => argument.startsWith('--dump='))
const databaseFlag = process.argv.find((argument) =>
  argument.startsWith('--db-url='),
)
if (!dumpFlag || !databaseFlag) {
  throw new Error(
    'Usage: pnpm backup:restore:test -- --dump=<file> --db-url=<local postgres URL>',
  )
}

const dumpPath = resolve(dumpFlag.slice('--dump='.length))
const databaseUrl = new URL(databaseFlag.slice('--db-url='.length))
if (!['localhost', '127.0.0.1', '::1'].includes(databaseUrl.hostname)) {
  throw new Error(
    'Restore verification is restricted to a local or disposable test database',
  )
}

const command = process.platform === 'win32' ? 'psql.exe' : 'psql'
async function run(args) {
  const exitCode = await new Promise((resolveExit, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: false })
    child.once('error', reject)
    child.once('exit', (code) => resolveExit(code ?? 1))
  })
  if (exitCode !== 0) throw new Error(`psql exited ${exitCode}`)
}

await run([
  '--set',
  'ON_ERROR_STOP=1',
  '--single-transaction',
  '--dbname',
  databaseUrl.toString(),
  '--file',
  dumpPath,
])
await run([
  '--set',
  'ON_ERROR_STOP=1',
  '--dbname',
  databaseUrl.toString(),
  '--command',
  'select count(*) from public.experiments; select count(*) from private.cash_ledger_entries; select count(*) from private.ai_budget_reservations;',
])
process.stdout.write('{"status":"local_restore_verified"}\n')
