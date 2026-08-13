import {
  chmod,
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'

import { localCiConfig, localCiMarker } from './lib/owned-local-ci-stack.mjs'
import {
  newExternalPath,
  verifiedExternalDirectory,
} from './lib/safe-artifact-path.mjs'

function options(argv) {
  const entries = argv.map((argument) => {
    const match = /^--(output-dir|run-id)=(.+)$/u.exec(argument)
    if (!match) throw new Error('Owned local CI stack arguments are invalid')
    return [match[1], match[2]]
  })
  const parsed = Object.fromEntries(entries)
  if (entries.length !== 2 || new Set(entries.map(([key]) => key)).size !== 2) {
    throw new Error('Exact run ID and new output directory are required')
  }
  return parsed
}

async function copySqlTests(workspace, output) {
  const source = path.join(workspace, 'supabase', 'tests')
  const target = path.join(output, 'supabase', 'tests')
  await mkdir(target, { recursive: true, mode: 0o700 })
  const entries = await readdir(source, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile() || !/^\d{4}_[a-z0-9_]+\.sql$/u.test(entry.name)) {
      throw new Error('Supabase SQL test closure contains an unexpected entry')
    }
    const bytes = await readFile(path.join(source, entry.name))
    await writeFile(path.join(target, entry.name), bytes, {
      flag: 'wx',
      mode: 0o600,
    })
  }
}

async function main() {
  const requested = options(process.argv.slice(2))
  const workspace = await realpath(process.cwd())
  const output = await newExternalPath(workspace, requested['output-dir'])
  const config = Buffer.from(localCiConfig(requested['run-id']), 'utf8')
  await mkdir(path.join(output, 'supabase'), { recursive: true, mode: 0o700 })
  await writeFile(path.join(output, 'supabase', 'config.toml'), config, {
    flag: 'wx',
    mode: 0o600,
  })
  await copySqlTests(workspace, output)
  const marker = localCiMarker(requested['run-id'], config)
  await writeFile(
    path.join(output, '.capital-lab-owned-ci-stack.json'),
    `${JSON.stringify(marker)}\n`,
    { flag: 'wx', mode: 0o600 },
  )
  await chmod(output, 0o700)
  await verifiedExternalDirectory(workspace, output)
  process.stdout.write(
    `${JSON.stringify({ status: 'owned_local_ci_stack_created', projectId: marker.projectId, runId: marker.runId })}\n`,
  )
}

await main().catch(() => {
  process.stderr.write('Owned local CI stack creation failed closed.\n')
  process.exit(1)
})
