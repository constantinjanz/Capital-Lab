import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const outputFlag = process.argv.find((argument) =>
  argument.startsWith('--output-dir='),
)
if (!outputFlag) {
  throw new Error(
    'Usage: pnpm backup:critical -- --output-dir=<external-directory>',
  )
}

const outputDirectory = resolve(outputFlag.slice('--output-dir='.length))
const workspace = resolve(process.cwd())
if (
  outputDirectory === workspace ||
  outputDirectory.startsWith(
    `${workspace}${process.platform === 'win32' ? '\\' : '/'}`,
  )
) {
  throw new Error('Backup output must be outside the Capital Lab repository')
}
const databaseUrl = process.env.CAPITAL_LAB_DATABASE_URL
if (!databaseUrl) {
  throw new Error('CAPITAL_LAB_DATABASE_URL is required and is never printed')
}
const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
const dumpPath = resolve(
  outputDirectory,
  `capital-lab-critical-${timestamp}.sql`,
)
const manifestPath = resolve(
  outputDirectory,
  `capital-lab-critical-${timestamp}.json`,
)

await mkdir(outputDirectory, { recursive: true })

const criticalRelations = [
  'public.experiments',
  'public.experiment_versions',
  'public.experiment_controls',
  'public.orders',
  'public.fills',
  'public.positions',
  'public.agent_runs',
  'public.agent_decisions',
  'public.model_pricing',
  'public.ai_budget_policies',
  'public.budget_alerts',
  'public.budget_threshold_alerts',
  'public.model_comparisons',
  'private.cash_ledger_entries',
  'private.ai_budget_periods',
  'private.ai_budget_reservations',
  'private.ai_usage_events',
  'private.scheduler_slots',
  'private.scheduler_runs',
  'private.audit_log',
]

const command = process.platform === 'win32' ? 'supabase.cmd' : 'supabase'
const version = spawnSync(command, ['--version'], {
  encoding: 'utf8',
  shell: false,
})
if (version.status !== 0 || version.stdout.trim() !== '2.113.0') {
  throw new Error('Supabase CLI 2.113.0 is required for backup evidence')
}
const args = [
  'db',
  'dump',
  '--linked',
  '--data-only',
  '--use-copy',
  '--file',
  dumpPath,
]
const exitCode = await new Promise((resolveExit, reject) => {
  const child = spawn(command, args, { stdio: 'inherit', shell: false })
  child.once('error', reject)
  child.once('exit', (code) => resolveExit(code ?? 1))
})
if (exitCode !== 0) throw new Error(`supabase db dump exited ${exitCode}`)

const dumpSha256 = createHash('sha256')
  .update(await readFile(dumpPath))
  .digest('hex')
const git = spawnSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8',
  shell: false,
})
if (git.status !== 0 || !/^[0-9a-f]{40}$/.test(git.stdout.trim())) {
  throw new Error('Exact Git commit could not be recorded')
}

const psql = process.platform === 'win32' ? 'psql.exe' : 'psql'
const evidenceSqlPath = resolve(
  'supabase',
  'backup',
  'critical-restore-evidence.sql',
)
const evidenceResult = spawnSync(
  psql,
  ['--tuples-only', '--no-align', '--file', evidenceSqlPath],
  {
    env: { ...process.env, PGDATABASE: databaseUrl, PGCONNECT_TIMEOUT: '10' },
    encoding: 'utf8',
    shell: false,
  },
)
if (evidenceResult.status !== 0) {
  throw new Error('Critical relation evidence query failed')
}
const restoreEvidence = JSON.parse(evidenceResult.stdout.trim())

await writeFile(
  manifestPath,
  `${JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      gitCommitSha: git.stdout.trim(),
      supabaseCliVersion: '2.113.0',
      dumpPath,
      dumpSha256,
      scope:
        'full linked database data; critical relations listed for restore verification',
      criticalRelations,
      restoreEvidence,
      storageRequirement: 'Keep outside the Capital Lab Supabase project.',
    },
    null,
    2,
  )}\n`,
  'utf8',
)
process.stdout.write(
  `${JSON.stringify({ status: 'backup_evidence_created', dumpPath, manifestPath })}\n`,
)
