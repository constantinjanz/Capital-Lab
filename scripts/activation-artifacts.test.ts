import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const root = process.cwd()

async function text(relativePath: string): Promise<string> {
  return readFile(path.join(root, relativePath), 'utf8')
}

describe('activation phase separation', () => {
  it('keeps both app/schema migrations free of extensions, Vault writes, jobs, and HTTP', async () => {
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
      expect(migration).not.toMatch(
        /(?:perform|select)\s+private\.dispatch_no_ai_shadow_dry_run_event\s*\(/i,
      )
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

  it('installs only two disabled jobs through supported Cron APIs', async () => {
    const installer = await text(
      'supabase/activation/install-hosted-scheduler-jobs-disabled.sql',
    )
    expect(installer.match(/:=\s*cron\.schedule\s*\(/gi)).toHaveLength(2)
    expect(
      installer.match(/cron\.alter_job\([^;]+active := false\)/gi),
    ).toHaveLength(2)
    expect(installer).not.toMatch(
      /(?:insert|update|delete)\s+(?:into|from)?\s*cron\.job/i,
    )
    expect(installer).not.toMatch(
      /(?:select|perform)\s+net\.http_(?:get|post)\s*\(/i,
    )
  })

  it('keeps arming and shutdown separate from provisioning', async () => {
    const arm = await text('supabase/activation/enable-hosted-scheduler.sql')
    const stop = await text('supabase/activation/disable-hosted-scheduler.sql')
    expect(arm).not.toMatch(/create extension|cron\.schedule|vault\./i)
    expect(arm).toMatch(/cron\.alter_job\([^;]+active := true\)/i)
    expect(stop).toMatch(/cron\.unschedule/i)
    expect(stop).not.toMatch(
      /(?:insert|update|delete)\s+(?:into|from)?\s*cron\.job/i,
    )
  })

  it('makes versioned psql files fail on the first SQL error', async () => {
    const activationDirectory = path.join(root, 'supabase', 'activation')
    const files = [
      'prepare-no-ai-dry-run.sql',
      'prepare-scheduler-infrastructure.sql',
      'verify-scheduler-vault.sql',
      'install-hosted-scheduler-jobs-disabled.sql',
      'request-scheduler-auth-noop.sql',
      'verify-scheduler-auth-noop.sql',
      'plan-and-freeze-no-ai-dry-run.sql',
      'enable-hosted-scheduler.sql',
      'disable-hosted-scheduler.sql',
    ]
    for (const filename of files) {
      const content = await readFile(
        path.join(activationDirectory, filename),
        'utf8',
      )
      expect(content).toContain('\\set ON_ERROR_STOP on')
    }
  })
})
