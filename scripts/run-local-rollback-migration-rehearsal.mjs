import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  canonicalJson,
  loadCriticalRelationContract,
} from './critical-backup-contract.mjs'
import { canonicalRepositoryTextBytes } from './lib/canonical-repository-bytes.mjs'
import {
  isOwnedLocalPostgresToolFailure,
  ownedPsql,
} from './lib/local-container-postgres.mjs'
import { LocalContainerImageIdentityRejection } from './lib/local-container-identity-diagnostic.mjs'
import {
  buildLocalRollbackMigrationRehearsalFailureDiagnostic,
  buildLocalRollbackMigrationRehearsalSuccess,
  buildLocalRollbackRehearsalClientStageMarkerPlan,
  LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN,
  localRollbackRehearsalStageMarkerFromClientIndex,
  localRollbackRehearsalStageMarkerPsqlCommand,
  ROLLBACK_MIGRATION_BASENAMES,
  serializeLocalRollbackMigrationRehearsalFailureDiagnostic,
  serializeLocalRollbackMigrationRehearsalSuccess,
} from './lib/local-rollback-rehearsal-diagnostic.mjs'
import {
  resolvedArguments,
  resolveNativeExecutable,
} from './lib/safe-process.mjs'
import { extractRollbackMigrationBody } from './migration-rehearsal-contract.mjs'

const PROBE_RELATION = 'private.no_ai_shadow_dry_runs'
const SHA256 = /^[0-9a-f]{64}$/u

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

function validateLoadedMigrations(migrations) {
  if (
    !Array.isArray(migrations) ||
    migrations.length !== ROLLBACK_MIGRATION_BASENAMES.length
  ) {
    fail('Rollback rehearsal migration set is invalid')
  }
  for (let index = 0; index < migrations.length; index += 1) {
    const migration = migrations[index]
    if (
      migration === null ||
      typeof migration !== 'object' ||
      Array.isArray(migration) ||
      Object.keys(migration).sort().join(',') !== 'body,name,sha256' ||
      migration.name !== ROLLBACK_MIGRATION_BASENAMES[index] ||
      typeof migration.body !== 'string' ||
      migration.body.length === 0 ||
      typeof migration.sha256 !== 'string' ||
      !SHA256.test(migration.sha256)
    ) {
      fail('Rollback rehearsal migration set is invalid')
    }
  }
  return migrations
}

export const ROLLBACK_HISTORY_BASELINE_SQL = `select coalesce(jsonb_agg(jsonb_build_object(
  'name', name, 'version', version
) order by version), '[]'::jsonb)
from supabase_migrations.schema_migrations;`

export function buildRollbackHistoryBaselineSql() {
  return `${localRollbackRehearsalStageMarkerPsqlCommand(
    LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN[0],
  )}${ROLLBACK_HISTORY_BASELINE_SQL}`
}

export function buildRollbackMigrationRehearsalSql(migrations) {
  validateLoadedMigrations(migrations)
  const migrationBodies = migrations.map(
    (migration, index) =>
      `${localRollbackRehearsalStageMarkerPsqlCommand(
        LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN[index + 1],
      )}${migration.body}`,
  )
  return `\\set ON_ERROR_STOP on
set statement_timeout = '300s';
set lock_timeout = '10s';
begin;
${migrationBodies.join('\n')}
${localRollbackRehearsalStageMarkerPsqlCommand(
  LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN[5],
)}do $rehearsal$
begin
  if to_regclass('${PROBE_RELATION}') is null then
    raise exception 'rollback rehearsal probe relation is missing';
  end if;
end
$rehearsal$;
${localRollbackRehearsalStageMarkerPsqlCommand(
  LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN[6],
)}rollback;
select case
  when to_regclass('${PROBE_RELATION}') is null then 'rollback_verified'
  else 'rollback_failed'
end;
`
}

function failClosed() {
  const error = new Error('Local rollback migration rehearsal failed closed')
  delete error.stack
  throw error
}

function emitFailure(marker, processOutcome, write) {
  let diagnostic
  try {
    diagnostic = buildLocalRollbackMigrationRehearsalFailureDiagnostic({
      ...marker,
      psqlExitCode: processOutcome.psqlExitCode,
      sqlstate: processOutcome.sqlstate,
      signal: processOutcome.signal,
      timedOut: processOutcome.timedOut,
    })
  } catch {
    failClosed()
  }
  write(serializeLocalRollbackMigrationRehearsalFailureDiagnostic(diagnostic))
  failClosed()
}

function observeOwnedPsqlFailure(
  error,
  expectedStartIndex,
  { isIdentityRejection, isOwnedFailure, write },
) {
  if (isIdentityRejection(error)) throw error
  if (!isOwnedFailure(error) || error.lastClientStageMarkerIndex === null) {
    failClosed()
  }
  let marker
  try {
    marker = localRollbackRehearsalStageMarkerFromClientIndex(
      error.lastClientStageMarkerIndex,
      { expectedStartIndex },
    )
  } catch {
    failClosed()
  }
  emitFailure(
    marker,
    {
      psqlExitCode: error.exitCode,
      signal: error.signal,
      sqlstate: error.sqlstate,
      timedOut: error.timedOut,
    },
    write,
  )
}

function expectedHistoryFromContract(preContract) {
  if (
    preContract === null ||
    typeof preContract !== 'object' ||
    !Array.isArray(preContract.migrations)
  ) {
    fail('Rollback rehearsal PRE contract is invalid')
  }
  return preContract.migrations.map(({ name, version }) => ({
    name: name.slice(15, -4),
    version,
  }))
}

export async function runRollbackDatabaseRehearsal({
  isIdentityRejection = (error) =>
    error instanceof LocalContainerImageIdentityRejection,
  isOwnedFailure = isOwnedLocalPostgresToolFailure,
  migrations,
  preContract,
  psql = ownedPsql,
  write = (value) => process.stdout.write(value),
}) {
  validateLoadedMigrations(migrations)
  const expectedHistory = expectedHistoryFromContract(preContract)
  let actualHistoryOutput
  try {
    actualHistoryOutput = await psql(
      'source',
      buildRollbackHistoryBaselineSql(),
      true,
      {
        clientStageMarkerPlan: buildLocalRollbackRehearsalClientStageMarkerPlan(
          {
            expectedStartIndex: 0,
          },
        ),
      },
    )
  } catch (error) {
    observeOwnedPsqlFailure(error, 0, {
      isIdentityRejection,
      isOwnedFailure,
      write,
    })
  }

  let actualHistory
  try {
    actualHistory = JSON.parse(actualHistoryOutput)
  } catch {
    emitFailure(
      LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN[0],
      {
        psqlExitCode: null,
        signal: null,
        sqlstate: null,
        timedOut: false,
      },
      write,
    )
  }
  if (canonicalJson(actualHistory) !== canonicalJson(expectedHistory)) {
    emitFailure(
      LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN[0],
      {
        psqlExitCode: null,
        signal: null,
        sqlstate: null,
        timedOut: false,
      },
      write,
    )
  }

  let rollbackResult
  try {
    rollbackResult = await psql(
      'source',
      buildRollbackMigrationRehearsalSql(migrations),
      true,
      {
        clientStageMarkerPlan: buildLocalRollbackRehearsalClientStageMarkerPlan(
          {
            expectedStartIndex: 1,
          },
        ),
      },
    )
  } catch (error) {
    observeOwnedPsqlFailure(error, 1, {
      isIdentityRejection,
      isOwnedFailure,
      write,
    })
  }
  if (rollbackResult !== 'rollback_verified') {
    emitFailure(
      LOCAL_ROLLBACK_REHEARSAL_STAGE_MARKER_PLAN[6],
      {
        psqlExitCode: null,
        signal: null,
        sqlstate: null,
        timedOut: false,
      },
      write,
    )
  }
  return rollbackResult
}

export function buildRollbackRehearsalSuccessOutput(commitSha, migrations) {
  validateLoadedMigrations(migrations)
  return serializeLocalRollbackMigrationRehearsalSuccess(
    buildLocalRollbackMigrationRehearsalSuccess({
      commitSha,
      migrationSetSha256: sha256(
        migrations
          .map((migration) => `${migration.name}:${migration.sha256}`)
          .join('\n'),
      ),
    }),
  )
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
    ROLLBACK_MIGRATION_BASENAMES.map(async (name) => {
      const bytes = await readFile(path.join(migrationDirectory, name))
      return {
        body: extractRollbackMigrationBody(bytes.toString('utf8'), name),
        name,
        sha256: sha256(canonicalRepositoryTextBytes(bytes)),
      }
    }),
  )
  const { contract: preContract } = await loadCriticalRelationContract(
    path.join(workspace, 'supabase', 'backup', 'pre-activation.v1.json'),
    'pre_activation',
  )
  await runRollbackDatabaseRehearsal({ migrations, preContract })
  if (
    git(['rev-parse', 'HEAD'], workspace) !== initialHead ||
    git(['status', '--porcelain=v1', '--untracked-files=all'], workspace)
  ) {
    fail('Git identity changed during local rollback rehearsal')
  }
  process.stdout.write(
    buildRollbackRehearsalSuccessOutput(initialHead, migrations),
  )
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main().catch(() => {
    process.stderr.write('Local rollback migration rehearsal failed closed.\n')
    process.exitCode = 1
  })
}
