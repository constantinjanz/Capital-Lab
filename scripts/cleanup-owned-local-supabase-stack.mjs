import { spawnSync } from 'node:child_process'
import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { ownedDatabaseContainer } from './lib/local-container-postgres.mjs'
import {
  inspectOwnedLocalSupabaseNetwork,
  ownedLocalSupabaseNetworkSpec,
  removeOwnedLocalSupabaseNetwork,
  safeOwnedLocalSupabaseNetworkEvidence,
} from './lib/owned-local-supabase-network.mjs'
import { verifiedExternalDirectory } from './lib/safe-artifact-path.mjs'
import {
  resolvedArguments,
  resolveNativeExecutable,
} from './lib/safe-process.mjs'

function options(argv) {
  const entries = argv.map((argument) => {
    const match = /^--(role|workdir)=(.+)$/u.exec(argument)
    if (!match)
      throw new Error('Owned local Supabase cleanup arguments are invalid')
    return [match[1], match[2]]
  })
  const parsed = Object.fromEntries(entries)
  if (
    entries.length !== 2 ||
    new Set(entries.map(([key]) => key)).size !== 2 ||
    !['reference', 'restore', 'source'].includes(parsed.role)
  ) {
    throw new Error('Exact owned local Supabase cleanup authority is required')
  }
  return parsed
}

function stopSupabase(workdir) {
  const executable = resolveNativeExecutable('supabase')
  const result = spawnSync(
    executable.command,
    resolvedArguments(executable, [
      'stop',
      '--no-backup',
      `--workdir=${workdir}`,
    ]),
    {
      encoding: 'utf8',
      shell: false,
      stdio: 'ignore',
      timeout: 120_000,
      windowsHide: true,
    },
  )
  if (result.status !== 0 || result.signal || result.error) {
    throw new Error('Owned local Supabase stack stop failed closed')
  }
}

export async function cleanupOwnedStack(argv, env = process.env) {
  const requested = options(argv)
  const workspace = await realpath(process.cwd())
  const workdir = await verifiedExternalDirectory(
    workspace,
    await realpath(path.resolve(requested.workdir)),
  )
  const target = ownedDatabaseContainer(requested.role, env)
  const config = await readFile(
    path.join(workdir, 'supabase', 'config.toml'),
    'utf8',
  )
  if (!config.startsWith(`project_id = "${target.projectId}"\n`)) {
    throw new Error('Owned local Supabase cleanup project identity is invalid')
  }
  const spec = ownedLocalSupabaseNetworkSpec(
    requested.role,
    target,
    env.CAPITAL_LAB_CI_COMMIT_SHA,
  )
  const before = inspectOwnedLocalSupabaseNetwork(spec, 'owned_or_empty')
  if (before.attachedContainerCount > 0) stopSupabase(workdir)
  const removed = removeOwnedLocalSupabaseNetwork(spec)
  return safeOwnedLocalSupabaseNetworkEvidence(
    'owned_local_supabase_network_removed',
    removed,
  )
}

async function main() {
  const evidence = await cleanupOwnedStack(process.argv.slice(2))
  process.stdout.write(`${JSON.stringify(evidence)}\n`)
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main().catch(() => {
    process.stderr.write('Owned local Supabase cleanup failed closed.\n')
    process.exit(1)
  })
}
