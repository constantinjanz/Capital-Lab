import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'

const outputFlag = process.argv.find((argument) =>
  argument.startsWith('--output-dir='),
)
if (!outputFlag) {
  throw new Error(
    'Usage: pnpm backup:critical -- --output-dir=<external-directory>',
  )
}

const outputDirectory = resolve(outputFlag.slice('--output-dir='.length))
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

await writeFile(
  manifestPath,
  `${JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      dumpPath,
      scope:
        'full linked database data; critical relations listed for restore verification',
      criticalRelations,
      storageRequirement: 'Keep outside the Capital Lab Supabase project.',
    },
    null,
    2,
  )}\n`,
  'utf8',
)
process.stdout.write(`${JSON.stringify({ dumpPath, manifestPath })}\n`)
