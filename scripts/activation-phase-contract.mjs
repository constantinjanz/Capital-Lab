import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { canonicalRepositoryTextBytes } from './lib/canonical-repository-bytes.mjs'

const PHASE_FILES = Object.freeze({
  arm: 'enable-hosted-scheduler.sql',
  'auth-endpoint-verify': 'verify-auth-deployment.sql',
  'auth-failure-reconcile': 'verify-scheduler-auth-failures.sql',
  'auth-failure-request': 'request-scheduler-auth-failures.sql',
  'auth-noop-reconcile': 'verify-scheduler-auth-noop.sql',
  'auth-noop-request': 'request-scheduler-auth-noop.sql',
  'baseline-freeze': 'plan-and-freeze-no-ai-dry-run.sql',
  'drain-reconcile': 'drain-reconcile.sql',
  'emergency-disable-jobs': 'emergency-disable-jobs.sql',
  'emergency-kill': 'emergency-kill.sql',
  'install-jobs-disabled': 'install-hosted-scheduler-jobs-disabled.sql',
  'manual-finalize': 'finalize-no-ai-dry-run.sql',
  'orderly-stop': 'disable-hosted-scheduler.sql',
  prepare: 'prepare-no-ai-dry-run.sql',
  'runtime-deployment-verify': 'verify-runtime-deployment.sql',
  'runtime-config-request': 'request-runtime-config-attestation.sql',
  'runtime-config-reconcile': 'verify-runtime-config-attestation.sql',
  'runtime-deployment-finalize': 'finalize-runtime-deployment.sql',
  'scheduler-infrastructure-preparation':
    'prepare-scheduler-infrastructure.sql',
  'unschedule-terminal-jobs': 'unschedule-terminal-jobs.sql',
  'vault-verification': 'verify-scheduler-vault.sql',
})

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

export async function buildActivationPhaseContract(repository) {
  const activationRoot = path.join(repository, 'supabase', 'activation')
  const phases = {}
  for (const [phase, file] of Object.entries(PHASE_FILES)) {
    phases[phase] = {
      file,
      sha256: sha256(
        canonicalRepositoryTextBytes(
          await readFile(path.join(activationRoot, file)),
        ),
      ),
    }
  }
  return { phases, schema_version: 4 }
}

async function main() {
  if (
    process.argv.length !== 3 ||
    !['--write', '--verify'].includes(process.argv[2])
  ) {
    throw new Error('Required: exactly one of --write or --verify')
  }
  const repository = process.cwd()
  const contractPath = path.join(
    repository,
    'supabase',
    'activation',
    'phase-contract.json',
  )
  const expectedBytes = Buffer.from(
    `${canonicalJson(await buildActivationPhaseContract(repository))}\n`,
  )
  if (process.argv[2] === '--write') {
    await writeFile(contractPath, expectedBytes)
  } else if (!Buffer.from(await readFile(contractPath)).equals(expectedBytes)) {
    throw new Error('Activation phase contract is incomplete or stale')
  }
  process.stdout.write(
    `${JSON.stringify({ status: process.argv[2] === '--write' ? 'generated' : 'verified', sha256: sha256(expectedBytes), phaseCount: Object.keys(PHASE_FILES).length })}\n`,
  )
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : 'Phase contract failed closed',
    )
    process.exit(1)
  })
}
