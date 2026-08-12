import { chmod, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { restoreProjectId } from './lib/local-supabase-target-proof.mjs'
import {
  newExternalPath,
  verifiedExternalDirectory,
  verifiedExternalFile,
} from './lib/safe-artifact-path.mjs'

function options() {
  const parsed = Object.fromEntries(
    process.argv.slice(2).map((argument) => {
      const match = /^--(output-dir|run-id)=(.+)$/u.exec(argument)
      if (!match) throw new Error('Restore stack arguments are invalid')
      return [match[1], match[2]]
    }),
  )
  if (Object.keys(parsed).length !== 2) {
    throw new Error('Required: --run-id=<run> --output-dir=<new-external-dir>')
  }
  return parsed
}

async function main() {
  const requested = options()
  const workspace = await realpath(process.cwd())
  const output = await newExternalPath(workspace, requested['output-dir'])
  const projectId = restoreProjectId(requested['run-id'])
  const template = await readFile(
    path.join(
      workspace,
      'supabase',
      'backup',
      'target-stack',
      'supabase',
      'config.toml',
    ),
    'utf8',
  )
  if (!template.startsWith('project_id = "capital-lab-restore-run"\n')) {
    throw new Error('Restore stack template identity drifted')
  }
  await mkdir(path.join(output, 'supabase'), {
    mode: 0o700,
    recursive: true,
  })
  await writeFile(
    path.join(output, 'supabase', 'config.toml'),
    template.replace(
      'project_id = "capital-lab-restore-run"',
      `project_id = "${projectId}"`,
    ),
    { mode: 0o600, flag: 'wx' },
  )
  await chmod(output, 0o700)
  await verifiedExternalDirectory(workspace, output)
  await verifiedExternalFile(
    workspace,
    path.join(output, 'supabase', 'config.toml'),
  )
  process.stdout.write(
    `${JSON.stringify({ status: 'run_specific_restore_stack_created', projectId, runId: requested['run-id'] })}\n`,
  )
}

await main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.message
      : 'Restore stack creation failed closed',
  )
  process.exit(1)
})
