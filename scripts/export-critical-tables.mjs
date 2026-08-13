import { spawn, spawnSync } from 'node:child_process'
import {
  chmod,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'

import {
  BACKUP_ARTIFACT_KEYS,
  AUTH_DATA_RELATIONS,
  assertContractKeys,
  assertForeignKeyCatalog,
  buildAuthEvidenceSql,
  buildCriticalEvidenceSql,
  buildForeignKeyCatalogSql,
  buildForeignKeyViolationSql,
  buildRolePolicySql,
  buildSensitiveAuthStateSql,
  buildServerIdentitySql,
  canonicalJson,
  criticalRelationSchemas,
  filterApplicationSchemaArchiveToc,
  fingerprintRolePolicy,
  loadCriticalRelationContract,
  loadSchemaGolden,
  redactedPostgresError,
  sha256,
} from './critical-backup-contract.mjs'
import { canonicalRepositoryTextBytes } from './lib/canonical-repository-bytes.mjs'
import {
  inspectOwnedDatabaseContainer,
  ownedPsql,
  runOwnedPostgresTool,
} from './lib/local-container-postgres.mjs'
import {
  resolvedArguments,
  resolveNativeExecutable,
} from './lib/safe-process.mjs'
import {
  newExternalPath,
  verifiedDirectChild,
  verifiedExternalDirectory,
} from './lib/safe-artifact-path.mjs'
import {
  loadMvccRaceControl,
  signalMvccMarker,
  waitForMvccMarker,
} from './lib/mvcc-race-control.mjs'

const SUPABASE_CLI_VERSION = '2.113.0'
const PROCESS_TIMEOUT_MS = 600_000

function options() {
  const entries = process.argv.slice(2).map((argument) => {
    const match = /^--(contract|output-dir)=(.+)$/u.exec(argument)
    if (!match) throw new Error('Backup arguments are invalid')
    return [match[1], match[2]]
  })
  const parsed = Object.fromEntries(entries)
  if (
    entries.length !== 2 ||
    new Set(entries.map(([key]) => key)).size !== 2 ||
    !['pre', 'post'].includes(parsed.contract)
  ) {
    throw new Error(
      'Required: --contract=pre|post --output-dir=<new-external-directory>',
    )
  }
  return parsed
}

function git(args, cwd) {
  const executable = resolveNativeExecutable('git')
  const result = spawnSync(
    executable.command,
    resolvedArguments(executable, args),
    {
      cwd,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    },
  )
  if (result.status !== 0 || result.signal || result.error) {
    throw new Error('Git evidence could not be derived')
  }
  return result.stdout.trim()
}

async function run(executableName, args, env, input) {
  const executable = resolveNativeExecutable(executableName)
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    const child = spawn(
      executable.command,
      resolvedArguments(executable, args),
      {
        env,
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )
    child.stdout.on('data', (chunk) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()))
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, PROCESS_TIMEOUT_MS)
    child.once('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code !== 0 || signal || timedOut) {
        reject(
          new Error(
            `PostgreSQL backup step failed; redacted database error: ${redactedPostgresError(stderr)}`,
          ),
        )
      } else resolve({ stdout, stderr })
    })
    child.stdin.end(input)
  })
}

function snapshotSql(sql, snapshot) {
  if (!/^[0-9A-Fa-f-]{8,128}$/u.test(snapshot)) {
    throw new Error('Exported PostgreSQL snapshot identity is invalid')
  }
  return `\\set ON_ERROR_STOP on
begin isolation level repeatable read read only;
set transaction snapshot '${snapshot}';
${sql}
commit;
`
}

async function evidence(sql, snapshot) {
  return JSON.parse(
    await ownedPsql('source', snapshot ? snapshotSql(sql, snapshot) : sql),
  )
}

async function assertForeignKeyIntegrity(snapshot) {
  const catalog = await evidence(buildForeignKeyCatalogSql(), snapshot)
  assertForeignKeyCatalog(catalog)
  for (const specification of catalog.constraints) {
    const result = await evidence(
      buildForeignKeyViolationSql(specification),
      snapshot,
    )
    if (result.violationCount !== '0') {
      throw new Error(
        'Backup source contains a foreign-key integrity violation',
      )
    }
  }
  return catalog
}

async function withExportedSnapshot(callback) {
  const target = inspectOwnedDatabaseContainer('source')
  const executable = resolveNativeExecutable('docker')
  const child = spawn(
    executable.command,
    resolvedArguments(executable, [
      'exec',
      '--interactive',
      target.container,
      'psql',
      '--username=postgres',
      '--dbname=postgres',
      '--no-psqlrc',
      '--quiet',
      '--tuples-only',
      '--no-align',
      '--set',
      'ON_ERROR_STOP=1',
    ]),
    {
      env: process.env,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )
  let stdout = ''
  let stderr = ''
  let settled = false
  let timedOut = false
  let resolveSnapshot
  let rejectSnapshot
  const snapshotReady = new Promise((resolve, reject) => {
    resolveSnapshot = resolve
    rejectSnapshot = reject
  })
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString()
    const snapshot = stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find((line) => /^[0-9A-Fa-f-]{8,128}$/u.test(line))
    if (snapshot) resolveSnapshot(snapshot)
  })
  child.stderr.on('data', (chunk) => (stderr += chunk.toString()))
  const exit = new Promise((resolve, reject) => {
    child.once('error', (error) => {
      if (settled) return
      settled = true
      rejectSnapshot(error)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      if (settled) return
      settled = true
      if (code !== 0 || signal || timedOut) {
        const error = new Error(
          `PostgreSQL snapshot holder failed; redacted database error: ${redactedPostgresError(stderr)}`,
        )
        rejectSnapshot(error)
        reject(error)
      } else resolve()
    })
  })
  const timer = setTimeout(() => {
    timedOut = true
    child.kill('SIGTERM')
  }, PROCESS_TIMEOUT_MS)
  child.stdin.write(
    'begin isolation level repeatable read read only;\nselect pg_export_snapshot();\n',
  )
  try {
    const snapshot = await snapshotReady
    return await callback(snapshot)
  } finally {
    if (!child.stdin.destroyed) child.stdin.end('rollback;\n')
    try {
      await exit
    } finally {
      clearTimeout(timer)
    }
  }
}

async function toolVersion(name, databaseTool = false) {
  if (databaseTool) {
    const result = await runOwnedPostgresTool('source', name, ['--version'])
    return result.stdout.trim()
  }
  const executable = resolveNativeExecutable(name)
  const result = spawnSync(
    executable.command,
    resolvedArguments(executable, ['--version']),
    {
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    },
  )
  if (result.status !== 0 || result.signal || result.error) {
    throw new Error(`${name} is unavailable`)
  }
  return result.stdout.trim()
}

async function writeDatabaseDump(filename, args, binary = false) {
  const result = await runOwnedPostgresTool(
    'source',
    'pg_dump',
    args,
    undefined,
    { binary },
  )
  await writeFile(filename, result.stdout, { mode: 0o600, flag: 'wx' })
}

async function main() {
  const requested = options()
  const workspace = await realpath(process.cwd())
  if (git(['status', '--porcelain=v1', '--untracked-files=all'], workspace)) {
    throw new Error('Backup creation requires a completely clean Working Tree')
  }
  const commitSha = git(['rev-parse', 'HEAD'], workspace)
  if (!/^[0-9a-f]{40}$/u.test(commitSha))
    throw new Error('Exact Git HEAD is invalid')
  const outputPath = await newExternalPath(workspace, requested['output-dir'])
  await mkdir(outputPath, { recursive: false, mode: 0o700 })
  await verifiedExternalDirectory(workspace, outputPath)
  let completed = false
  try {
    const mvccRaceControl = await loadMvccRaceControl(workspace)
    inspectOwnedDatabaseContainer('source')
    const contractKind =
      requested.contract === 'pre' ? 'pre_activation' : 'post_activation'
    const contractPath = path.join(
      workspace,
      'supabase',
      'backup',
      requested.contract === 'pre'
        ? 'pre-activation.v1.json'
        : 'post-activation.v1.json',
    )
    const { contract, sha256: relationContractSha256 } =
      await loadCriticalRelationContract(contractPath, contractKind)
    const goldenPath = path.join(
      workspace,
      'supabase',
      'backup',
      requested.contract === 'pre'
        ? 'pre-activation.schema-golden.v2.json'
        : 'post-activation.schema-golden.v2.json',
    )
    const { golden, sha256: schemaGoldenSha256 } = await loadSchemaGolden(
      goldenPath,
      contractKind,
      relationContractSha256,
    )
    const dataSchemas = criticalRelationSchemas(contract)
    const migrationDirectory = path.join(workspace, 'supabase', 'migrations')
    for (const migration of contract.migrations) {
      if (
        sha256(
          canonicalRepositoryTextBytes(
            await readFile(path.join(migrationDirectory, migration.name)),
          ),
        ) !== migration.sha256
      ) {
        throw new Error('Backup migration checksum contract drifted')
      }
    }
    const restorePreludePath = path.join(
      workspace,
      'supabase',
      'backup',
      'seed-free-target-prelude.sql',
    )
    const restorePreludeSha256 = sha256(await readFile(restorePreludePath))
    const supabaseVersion = await toolVersion('supabase')
    if (supabaseVersion !== SUPABASE_CLI_VERSION) {
      throw new Error(`Supabase CLI ${SUPABASE_CLI_VERSION} is required`)
    }
    const psqlVersion = await toolVersion('psql', true)
    const pgDumpVersion = await toolVersion('pg_dump', true)
    const pgDumpallVersion = await toolVersion('pg_dumpall', true)
    const pgRestoreVersion = await toolVersion('pg_restore')
    const identityBefore = await evidence(buildServerIdentitySql())
    const rolePolicyBefore = await evidence(buildRolePolicySql())
    const paths = {
      roles: path.join(outputPath, 'roles.sql'),
      authSchema: path.join(outputPath, 'auth-schema.sql'),
      authData: path.join(outputPath, 'auth-data.sql'),
      schema: path.join(outputPath, 'schema.sql'),
      data: path.join(outputPath, 'data.sql'),
      historySchema: path.join(outputPath, 'migration-history-schema.sql'),
      historyData: path.join(outputPath, 'migration-history-data.sql'),
      manifest: path.join(outputPath, 'manifest.json'),
    }
    const schemaArchive = path.join(outputPath, '.application-schema.dump')
    const schemaToc = path.join(outputPath, '.application-schema.toc')
    const rolesDump = await runOwnedPostgresTool('source', 'pg_dumpall', [
      '--roles-only',
      '--no-role-passwords',
    ])
    await writeFile(paths.roles, rolesDump.stdout, { mode: 0o600, flag: 'wx' })
    const evidenceSql = buildCriticalEvidenceSql(contract)
    let evidenceBefore
    let authEvidence
    let sensitiveAuthBefore
    let foreignKeyCatalogBefore
    let filteredToc
    let mvccRaceFixtureEnabled = false
    await withExportedSnapshot(async (snapshot) => {
      evidenceBefore = await evidence(evidenceSql, snapshot)
      authEvidence = await evidence(buildAuthEvidenceSql(), snapshot)
      sensitiveAuthBefore = await evidence(
        buildSensitiveAuthStateSql(),
        snapshot,
      )
      foreignKeyCatalogBefore = await assertForeignKeyIntegrity(snapshot)
      assertContractKeys(contract, evidenceBefore)
      if (
        canonicalJson(evidenceBefore.appliedMigrations) !==
          canonicalJson(
            contract.migrations.map(({ name, version }) => ({
              name: name.slice(15, -4),
              version,
            })),
          ) ||
        evidenceBefore.schemaFingerprintSha256 !==
          golden.schemaFingerprintSha256 ||
        canonicalJson(evidenceBefore.schemaEvidence) !==
          canonicalJson(golden.schemaEvidence) ||
        sha256(canonicalJson(evidenceBefore.schemaEvidence)) !==
          golden.schemaEvidenceSha256 ||
        evidenceBefore.relationSetSha256 !== golden.relationSetSha256 ||
        evidenceBefore.migrationHistorySha256 !== golden.migrationHistorySha256
      ) {
        throw new Error(
          'Source schema, migration history, or relation set differs from the committed golden',
        )
      }
      if (mvccRaceControl) {
        await signalMvccMarker(workspace, mvccRaceControl, 'snapshot-ready')
        await waitForMvccMarker(mvccRaceControl, 'mutation-visible')
        mvccRaceFixtureEnabled = true
      }
      const snapshotArgument = `--snapshot=${snapshot}`
      await writeDatabaseDump(paths.authSchema, [
        snapshotArgument,
        '--schema-only',
        '--schema',
        'auth',
      ])
      await writeDatabaseDump(paths.authData, [
        snapshotArgument,
        '--data-only',
        '--no-owner',
        '--no-privileges',
        ...AUTH_DATA_RELATIONS.flatMap((relation) => ['--table', relation]),
      ])
      await writeDatabaseDump(
        schemaArchive,
        [
          snapshotArgument,
          '--format=custom',
          '--schema-only',
          '--schema',
          'public',
          '--schema',
          'private',
        ],
        true,
      )
      await chmod(schemaArchive, 0o600)
      const archiveToc = await run(
        'pg_restore',
        ['--list', schemaArchive],
        process.env,
      )
      filteredToc = filterApplicationSchemaArchiveToc(archiveToc.stdout)
      await writeFile(schemaToc, filteredToc.toc, {
        mode: 0o600,
        flag: 'wx',
      })
      await run(
        'pg_restore',
        [
          '--no-owner',
          '--use-list',
          schemaToc,
          '--file',
          paths.schema,
          schemaArchive,
        ],
        process.env,
      )
      await rm(schemaArchive, { force: true })
      await rm(schemaToc, { force: true })
      for (const [file, schemas, schemaOnly] of [
        [paths.data, ['public', 'private'], false],
        [paths.historySchema, ['supabase_migrations'], true],
        [paths.historyData, ['supabase_migrations'], false],
      ]) {
        await writeDatabaseDump(file, [
          snapshotArgument,
          schemaOnly ? '--schema-only' : '--data-only',
          '--no-owner',
          ...(schemaOnly ? [] : ['--no-privileges']),
          ...schemas.flatMap((schema) => ['--schema', schema]),
        ])
      }
      if (mvccRaceControl) {
        await signalMvccMarker(workspace, mvccRaceControl, 'dumps-complete')
        await waitForMvccMarker(mvccRaceControl, 'source-restored')
      }
    })
    for (const key of BACKUP_ARTIFACT_KEYS) await chmod(paths[key], 0o600)
    const identityAfter = await evidence(buildServerIdentitySql())
    const rolePolicyAfter = await evidence(buildRolePolicySql())
    const evidenceAfter = await evidence(evidenceSql)
    const authEvidenceAfter = await evidence(buildAuthEvidenceSql())
    const sensitiveAuthAfter = await evidence(buildSensitiveAuthStateSql())
    const foreignKeyCatalogAfter = await assertForeignKeyIntegrity()
    if (
      canonicalJson(identityBefore) !== canonicalJson(identityAfter) ||
      canonicalJson(rolePolicyBefore) !== canonicalJson(rolePolicyAfter) ||
      canonicalJson(evidenceBefore) !== canonicalJson(evidenceAfter) ||
      canonicalJson(authEvidence) !== canonicalJson(authEvidenceAfter) ||
      canonicalJson(sensitiveAuthBefore) !==
        canonicalJson(sensitiveAuthAfter) ||
      canonicalJson(foreignKeyCatalogBefore) !==
        canonicalJson(foreignKeyCatalogAfter)
    ) {
      throw new Error(
        'Backup source changed or database identity switched during export',
      )
    }
    const artifacts = {}
    await verifiedExternalDirectory(workspace, outputPath)
    for (const key of BACKUP_ARTIFACT_KEYS) {
      const artifactPath = await verifiedDirectChild(outputPath, paths[key])
      artifacts[key] = {
        file: path.basename(artifactPath),
        sha256: sha256(await readFile(artifactPath)),
      }
    }
    const manifest = {
      artifacts,
      authEvidence,
      contractKind,
      createdAt: new Date().toISOString(),
      dataSchemas,
      defaultAclPolicy: {
        applicationEntryCount: filteredToc.applicationCount,
        applicationOwner: 'postgres',
        platformExcludedEntryCount: filteredToc.platformCount,
        platformExcludedOwner: 'supabase_admin',
      },
      gitCommitSha: commitSha,
      migrations: contract.migrations,
      snapshotPolicy: {
        applicationAuthAndHistoryShareExportedSnapshot: true,
        isolation: 'repeatable read read only',
        rolePolicyComparedOutsideSnapshot: true,
        sourceStateReverifiedAfterExport: true,
        localRaceFixture: mvccRaceFixtureEnabled
          ? 'application-setting-v1'
          : null,
      },
      relationContractSha256,
      relationSetSha256: evidenceBefore.relationSetSha256,
      relations: evidenceBefore.relations,
      restorePreludeSha256,
      schemaContractVersion: `capital-lab-${contractKind}-backup-v7`,
      schemaEvidenceSha256: golden.schemaEvidenceSha256,
      schemaFingerprintSha256: evidenceBefore.schemaFingerprintSha256,
      schemaGoldenSha256,
      schemaVersion: 7,
      source: {
        appliedMigrations: evidenceBefore.appliedMigrations,
        databaseFingerprint: evidenceBefore.databaseFingerprint,
        rolePolicyFingerprint: fingerprintRolePolicy(rolePolicyBefore),
        schemaEvidenceSha256: golden.schemaEvidenceSha256,
        schemaFingerprintSha256: evidenceBefore.schemaFingerprintSha256,
        migrationHistorySha256: evidenceBefore.migrationHistorySha256,
        serverFingerprint: sha256(identityBefore.serverIdentity),
        serverVersion: evidenceBefore.serverVersion,
      },
      toolVersions: {
        pgDump: pgDumpVersion,
        pgDumpall: pgDumpallVersion,
        pgRestore: pgRestoreVersion,
        psql: psqlVersion,
        supabase: supabaseVersion,
      },
    }
    const manifestBytes = Buffer.from(`${canonicalJson(manifest)}\n`)
    await writeFile(paths.manifest, manifestBytes, { mode: 0o600, flag: 'wx' })
    const manifestPath = await verifiedDirectChild(outputPath, paths.manifest)
    if (!(await readFile(manifestPath)).equals(manifestBytes)) {
      throw new Error('Backup manifest identity changed after creation')
    }
    completed = true
    process.stdout.write(
      `${JSON.stringify({ status: 'backup_created', contractKind, relationCount: contract.relations.length, manifestSha256: sha256(manifestBytes), schemaMatchesGolden: true, activationEligible: false, sensitiveArtifact: true })}\n`,
    )
  } finally {
    if (!completed) {
      await verifiedExternalDirectory(workspace, outputPath)
      await rm(outputPath, { recursive: true, force: true })
    }
  }
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Backup failed closed')
  process.exit(1)
})
