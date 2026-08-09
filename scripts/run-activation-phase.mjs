import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const projectRef = 'qrnuyibntcxwffrxmrvn'
const phases = new Map([
  ['prepare', 'prepare-no-ai-dry-run.sql'],
  ['infrastructure', 'prepare-scheduler-infrastructure.sql'],
  ['vault-verify', 'verify-scheduler-vault.sql'],
  ['jobs-disabled', 'install-hosted-scheduler-jobs-disabled.sql'],
  ['auth-noop-request', 'request-scheduler-auth-noop.sql'],
  ['auth-noop-verify', 'verify-scheduler-auth-noop.sql'],
  ['plan-baseline', 'plan-and-freeze-no-ai-dry-run.sql'],
  ['arm', 'enable-hosted-scheduler.sql'],
  ['stop', 'disable-hosted-scheduler.sql'],
])

function option(name) {
  return process.argv
    .find((argument) => argument.startsWith(`--${name}=`))
    ?.slice(name.length + 3)
}

const phase = option('phase')
const filename = phase ? phases.get(phase) : undefined
if (!phase || !filename) {
  console.error(`Phase must be one of: ${[...phases.keys()].join(', ')}`)
  process.exit(2)
}

const databaseUrl = process.env.CAPITAL_LAB_DATABASE_URL
const expectedChecksum = option('expected-sha256')
const expectedCommitSha = option('expected-commit-sha')
const configVersion = option('config-version')
const databaseFingerprint = option('database-fingerprint')
if (
  !databaseUrl ||
  !expectedChecksum?.match(/^[0-9a-f]{64}$/) ||
  !expectedCommitSha?.match(/^[0-9a-f]{40}$/) ||
  !configVersion ||
  !databaseFingerprint?.match(/^postgres:\d+$/)
) {
  console.error('Activation evidence arguments are incomplete or invalid.')
  process.exit(2)
}

let parsedUrl
try {
  parsedUrl = new URL(databaseUrl)
} catch {
  console.error('Activation database URL is invalid.')
  process.exit(2)
}
if (
  parsedUrl.protocol !== 'postgresql:' ||
  (!parsedUrl.hostname.includes(projectRef) &&
    !decodeURIComponent(parsedUrl.username).includes(projectRef))
) {
  console.error(
    'Activation database target does not match the expected project.',
  )
  process.exit(2)
}

const scriptPath = path.join(process.cwd(), 'supabase', 'activation', filename)
const script = await readFile(scriptPath)
const actualChecksum = createHash('sha256').update(script).digest('hex')
if (actualChecksum !== expectedChecksum) {
  console.error('Activation script checksum does not match reviewed evidence.')
  process.exit(2)
}

const psqlArguments = [
  '--set',
  'ON_ERROR_STOP=1',
  '--set',
  `expected_project_ref=${projectRef}`,
  '--set',
  `expected_database_fingerprint=${databaseFingerprint}`,
  '--set',
  `expected_commit_sha=${expectedCommitSha}`,
  '--set',
  `config_version=${configVersion}`,
  '--set',
  `correlation_id=${randomUUID()}`,
]
for (const passthrough of [
  'server-consumer-scope-confirmation',
  'scheduler-secret-randomness-confirmation',
  'expected-scheduler-url',
  'vercel-scheduler-enabled',
  'production-deployment-id',
  'production-deployment-ready',
  'auth-noop-request-id',
  'activated-at',
  'decision-at',
]) {
  const value = option(passthrough)
  if (value !== undefined) {
    psqlArguments.push('--set', `${passthrough.replaceAll('-', '_')}=${value}`)
  }
}
psqlArguments.push('--file', scriptPath)

const result = spawnSync('psql', psqlArguments, {
  env: {
    ...process.env,
    PGDATABASE: databaseUrl,
    PGCONNECT_TIMEOUT: '10',
  },
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

process.stdout.write(
  `${JSON.stringify({
    schemaVersion: 1,
    phase,
    projectRef,
    commitSha: expectedCommitSha,
    databaseFingerprint,
    scriptPath: path.relative(process.cwd(), scriptPath).replaceAll('\\', '/'),
    scriptSha256: actualChecksum,
    exitCode: result.status ?? 1,
  })}\n`,
)
process.exit(result.status ?? 1)
