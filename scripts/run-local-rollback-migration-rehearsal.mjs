import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'

import {
  canonicalJson,
  loadCriticalRelationContract,
} from './critical-backup-contract.mjs'
import { ownedPsql } from './lib/local-container-postgres.mjs'
import {
  resolvedArguments,
  resolveNativeExecutable,
} from './lib/safe-process.mjs'
import { extractRollbackMigrationBody } from './migration-rehearsal-contract.mjs'

const MIGRATIONS = Object.freeze([
  '20260809150000_post_build_hosting_safety.sql',
  '20260809150417_activation_readiness_follow_up.sql',
  '20260812092043_fourth_activation_readiness_remediation.sql',
  '20260812140953_fourth_activation_readiness_review_closure.sql',
])
const PROBE_RELATION = 'private.no_ai_shadow_dry_runs'

function fail(message) {
  throw new Error(message)
}

function git(args, cwd) {
  const executable = resolveNativeExecutable('git')
  const result = spawnSync(
    executable.command,
    resolvedArguments(executable, args),
    { cwd, encoding: 'utf8', shell: false, windowsHide: true },
  )
  if (result.status !== 0 || result.signal || result.error) {
    fail('Git evidence could not be derived')
  }
  return result.stdout.trim()
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function main() {
  if (process.argv.length !== 2) {
    fail('This local rollback rehearsal accepts no arguments')
  }
  const workspace = await realpath(process.cwd())
  const initialHead = git(['rev-parse', 'HEAD'], workspace)
  if (!/^[0-9a-f]{40}$/u.test(initialHead)) fail('Git HEAD evidence is invalid')
  if (git(['status', '--porcelain=v1', '--untracked-files=all'], workspace)) {
    fail('Local rollback rehearsal requires a completely clean Working Tree')
  }
  const migrationDirectory = path.join(workspace, 'supabase', 'migrations')
  const migrations = await Promise.all(
    MIGRATIONS.map(async (name) => {
      const bytes = await readFile(path.join(migrationDirectory, name))
      return {
        body: extractRollbackMigrationBody(bytes.toString('utf8'), name),
        name,
        sha256: sha256(bytes),
      }
    }),
  )
  const { contract: preContract } = await loadCriticalRelationContract(
    path.join(workspace, 'supabase', 'backup', 'pre-activation.v1.json'),
    'pre_activation',
  )
  const actualHistory = JSON.parse(
    await ownedPsql(
      'source',
      `select coalesce(jsonb_agg(jsonb_build_object(
        'name', name, 'version', version
      ) order by version), '[]'::jsonb)
      from supabase_migrations.schema_migrations;`,
    ),
  )
  const expectedHistory = preContract.migrations.map(({ name, version }) => ({
    name: name.slice(15, -4),
    version,
  }))
  if (canonicalJson(actualHistory) !== canonicalJson(expectedHistory)) {
    fail('Rollback rehearsal source is not the exact PRE migration baseline')
  }
  const rehearsalSql = `\\set ON_ERROR_STOP on
set statement_timeout = '300s';
set lock_timeout = '10s';
begin;
${migrations.map((migration) => migration.body).join('\n')}
do $rehearsal$
begin
  if to_regclass('${PROBE_RELATION}') is null then
    raise exception 'rollback rehearsal probe relation is missing';
  end if;
end
$rehearsal$;
rollback;
select case
  when to_regclass('${PROBE_RELATION}') is null then 'rollback_verified'
  else 'rollback_failed'
end;
`
  if ((await ownedPsql('source', rehearsalSql)) !== 'rollback_verified') {
    fail('Local rollback rehearsal did not prove a clean rollback')
  }
  if (
    git(['rev-parse', 'HEAD'], workspace) !== initialHead ||
    git(['status', '--porcelain=v1', '--untracked-files=all'], workspace)
  ) {
    fail('Git identity changed during local rollback rehearsal')
  }
  process.stdout.write(
    `${JSON.stringify({
      commitSha: initialHead,
      migrationCount: migrations.length,
      migrationSetSha256: sha256(
        migrations
          .map((migration) => `${migration.name}:${migration.sha256}`)
          .join('\n'),
      ),
      status: 'rollback_verified',
    })}\n`,
  )
}

await main()
