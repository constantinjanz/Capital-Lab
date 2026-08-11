import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { canonicalRepositoryTextBytes } from './lib/canonical-repository-bytes.mjs'
import { canonicalJson } from './run-activation-phase.mjs'

const root = process.cwd()

async function text(relativePath: string): Promise<string> {
  return readFile(path.join(root, relativePath), 'utf8')
}

describe('activation phase separation', () => {
  it('keeps app/schema migrations free of extension and Cron installation', async () => {
    for (const filename of [
      'supabase/migrations/20260809150000_post_build_hosting_safety.sql',
      'supabase/migrations/20260809150417_activation_readiness_follow_up.sql',
    ]) {
      const migration = await text(filename)
      expect(migration).not.toMatch(/create extension/i)
      expect(migration).not.toMatch(
        /vault\.create_secret|insert\s+into\s+vault/i,
      )
      expect(migration).not.toMatch(/cron\.schedule\s*\(/i)
    }
  })

  it('prepares unpinned extensions without creating jobs or sending HTTP', async () => {
    const infrastructure = await text(
      'supabase/activation/prepare-scheduler-infrastructure.sql',
    )
    expect(infrastructure).toMatch(/create extension if not exists pg_cron;/i)
    expect(infrastructure).toMatch(/create extension if not exists pg_net;/i)
    expect(infrastructure).not.toMatch(/create extension.+version/i)
    expect(infrastructure).not.toMatch(/cron\.schedule\s*\(/i)
    expect(infrastructure).not.toMatch(/net\.http_(?:get|post)\s*\(/i)
  })

  it('persists full job identities before supported ID-based disable operations', async () => {
    const installer = await text(
      'supabase/activation/install-hosted-scheduler-jobs-disabled.sql',
    )
    expect(installer.match(/:=\s*cron\.schedule\s*\(/gi)).toHaveLength(2)
    expect(installer.match(/register_activation_job_spec\s*\(/gi)).toHaveLength(
      2,
    )
    expect(installer).toMatch(/set_activation_jobs_active\s*\([^]*false/i)
    expect(installer.indexOf('register_activation_job_spec')).toBeLessThan(
      installer.indexOf('set_activation_jobs_active'),
    )
    expect(installer).not.toMatch(
      /(?:insert|update|delete)\s+(?:into|from)?\s*cron\.job/i,
    )
  })

  it('keeps DB-first emergency kill separate from Cron disable and unschedule', async () => {
    const kill = await text('supabase/activation/emergency-kill.sql')
    const disable = await text('supabase/activation/emergency-disable-jobs.sql')
    const unschedule = await text(
      'supabase/activation/unschedule-terminal-jobs.sql',
    )
    expect(kill).toMatch(/emergency_kill_activation_controls/i)
    expect(kill).not.toMatch(/cron\.(?:alter_job|schedule|unschedule)\s*\(/i)
    expect(kill).not.toMatch(/unschedule_terminal_activation_jobs\s*\(/i)
    expect(disable).toMatch(/disable_activation_jobs_after_emergency/i)
    expect(unschedule).toMatch(/unschedule_terminal_activation_jobs/i)
  })

  it('checksums every canonical phase file and uses no moving phase selection', async () => {
    const contractPath = path.join(
      root,
      'supabase',
      'activation',
      'phase-contract.json',
    )
    const bytes = canonicalRepositoryTextBytes(await readFile(contractPath))
    const contract = JSON.parse(bytes.toString('utf8')) as {
      schema_version: number
      phases: Record<string, { file: string; sha256: string }>
    }
    expect(bytes.toString('utf8')).toBe(`${canonicalJson(contract)}\n`)
    expect(contract.schema_version).toBe(3)
    expect(Object.keys(contract.phases).sort()).toEqual([
      'arm',
      'auth-endpoint-verify',
      'auth-failure-reconcile',
      'auth-failure-request',
      'auth-noop-reconcile',
      'auth-noop-request',
      'baseline-freeze',
      'drain-reconcile',
      'emergency-disable-jobs',
      'emergency-kill',
      'install-jobs-disabled',
      'manual-finalize',
      'orderly-stop',
      'prepare',
      'runtime-deployment-verify',
      'scheduler-infrastructure-preparation',
      'unschedule-terminal-jobs',
      'vault-verification',
    ])
    for (const phase of Object.values(contract.phases)) {
      const phaseBytes = canonicalRepositoryTextBytes(
        await readFile(path.join(root, 'supabase', 'activation', phase.file)),
      )
      expect(createHash('sha256').update(phaseBytes).digest('hex')).toBe(
        phase.sha256,
      )
      expect(phaseBytes.toString('utf8')).toContain('\set ON_ERROR_STOP on')
      expect(phaseBytes.toString('utf8')).not.toMatch(
        /(?:insert|update|delete)\s+(?:into|from)?\s*cron\.job/i,
      )
    }
  })
})
