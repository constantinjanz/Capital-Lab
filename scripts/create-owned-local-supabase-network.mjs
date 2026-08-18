import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { ownedDatabaseContainer } from './lib/local-container-postgres.mjs'
import {
  createOwnedLocalSupabaseNetwork,
  ownedLocalSupabaseNetworkSpec,
  safeOwnedLocalSupabaseNetworkEvidence,
} from './lib/owned-local-supabase-network.mjs'

function roleOption(argv) {
  if (argv.length !== 1 || !argv[0]?.startsWith('--role=')) {
    throw new Error('Exact owned local Supabase network role is required')
  }
  const role = argv[0].slice('--role='.length)
  if (!['reference', 'restore', 'source'].includes(role)) {
    throw new Error('Owned local Supabase network role is invalid')
  }
  return role
}

export function createNetworkForRole(role, env = process.env) {
  const target = ownedDatabaseContainer(role, env)
  const spec = ownedLocalSupabaseNetworkSpec(
    role,
    target,
    env.CAPITAL_LAB_CI_COMMIT_SHA,
  )
  return safeOwnedLocalSupabaseNetworkEvidence(
    'owned_local_supabase_network_created',
    createOwnedLocalSupabaseNetwork(spec),
  )
}

async function main() {
  const evidence = createNetworkForRole(roleOption(process.argv.slice(2)))
  process.stdout.write(`${JSON.stringify(evidence)}\n`)
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main().catch(() => {
    process.stderr.write(
      'Owned local Supabase network creation failed closed.\n',
    )
    process.exit(1)
  })
}
