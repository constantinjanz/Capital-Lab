import { spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { chmod, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  postgresUrlToLibpqEnv,
  redactedPostgresError,
} from './critical-backup-contract.mjs'
import {
  resolvedArguments,
  resolveNativeExecutable,
} from './lib/safe-process.mjs'
import {
  newExternalPath,
  verifiedExternalDirectory,
  verifiedExternalFile,
} from './lib/safe-artifact-path.mjs'

const PROCESS_TIMEOUT_MS = 120_000

function options() {
  const entries = process.argv.slice(2).map((argument) => {
    const match = /^--(credentials|mode|supabase-workdir)=(.+)$/u.exec(argument)
    if (!match) throw new Error('Local Auth fixture arguments are invalid')
    return [match[1], match[2]]
  })
  const parsed = Object.fromEntries(entries)
  if (
    !['prepare', 'verify', 'faults'].includes(parsed.mode) ||
    typeof parsed.credentials !== 'string' ||
    (parsed.mode === 'prepare' && entries.length !== 2) ||
    (['verify', 'faults'].includes(parsed.mode) &&
      (entries.length !== 3 ||
        typeof parsed['supabase-workdir'] !== 'string')) ||
    new Set(entries.map(([key]) => key)).size !== entries.length
  ) {
    throw new Error(
      'Required: --mode=prepare|verify|faults --credentials=<external-file> [--supabase-workdir=<stack-b>]',
    )
  }
  return parsed
}

async function exists(filename) {
  try {
    await stat(filename)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function run(name, args, env, input) {
  const executable = resolveNativeExecutable(name)
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
            `Local Auth fixture subprocess failed; redacted error: ${redactedPostgresError(stderr)}`,
          ),
        )
      } else resolve(stdout)
    })
    child.stdin.end(input)
  })
}

function exactLoopbackApi(value, port) {
  const parsed = new URL(value)
  if (
    parsed.protocol !== 'http:' ||
    parsed.hostname !== '127.0.0.1' ||
    parsed.port !== String(port) ||
    parsed.pathname !== '/' ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('Local Auth API origin is invalid')
  }
  return parsed.origin
}

async function localStatus(workdir, expectedPort) {
  const args = ['status', '--output', 'json']
  if (workdir) args.push('--workdir', await realpath(workdir))
  const status = JSON.parse(await run('supabase', args, process.env))
  const apiUrl = status.API_URL ?? status.api_url
  const serviceRole = status.SERVICE_ROLE_KEY ?? status.service_role_key
  const anonKey = status.ANON_KEY ?? status.anon_key
  if (
    typeof serviceRole !== 'string' ||
    serviceRole.length < 32 ||
    typeof anonKey !== 'string' ||
    anonKey.length < 32
  ) {
    throw new Error(
      'Local Supabase status omitted required in-memory Auth keys',
    )
  }
  return {
    anonKey,
    apiOrigin: exactLoopbackApi(apiUrl, expectedPort),
    serviceRole,
  }
}

async function query(connectionValue, sql) {
  const connection = postgresUrlToLibpqEnv(connectionValue, { localOnly: true })
  const output = await run(
    'psql',
    [
      '-X',
      '--no-psqlrc',
      '--quiet',
      '--tuples-only',
      '--no-align',
      '--set',
      'ON_ERROR_STOP=1',
    ],
    {
      ...process.env,
      ...connection.libpqEnv,
      PGCONNECT_TIMEOUT: '10',
      PGOPTIONS: '-c statement_timeout=60000 -c lock_timeout=10000',
    },
    sql,
  )
  return output.trim()
}

async function adminCreateUser(status, email, password) {
  const response = await fetch(`${status.apiOrigin}/auth/v1/admin/users`, {
    body: JSON.stringify({ email, email_confirm: true, password }),
    headers: {
      Authorization: `Bearer ${status.serviceRole}`,
      'Content-Type': 'application/json',
      apikey: status.serviceRole,
    },
    method: 'POST',
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
  })
  const body = await response.json().catch(() => null)
  if (response.status !== 200 || !/^[0-9a-f-]{36}$/u.test(body?.id ?? '')) {
    throw new Error('Local Auth API did not create the synthetic user')
  }
  return body.id
}

export function validateSyntheticAuthFixture(value) {
  if (
    value?.schemaVersion !== 2 ||
    !Array.isArray(value.users) ||
    value.users.length !== 2 ||
    value.users.some(
      (user) =>
        !/^[0-9a-f-]{36}$/u.test(user?.id ?? '') ||
        typeof user?.email !== 'string' ||
        typeof user?.password !== 'string',
    ) ||
    !/^[0-9a-f-]{36}$/u.test(value.rlsRecordId ?? '') ||
    value.ownerUserId !== value.users[0].id
  ) {
    throw new Error('Synthetic Auth credential fixture is invalid')
  }
  return value
}

function quoteUuid(value) {
  if (!/^[0-9a-f-]{36}$/u.test(value)) {
    throw new Error('Synthetic Auth fixture UUID is invalid')
  }
  return `'${value}'::uuid`
}

function authClosureSql(fixture) {
  const userIds = fixture.users.map((user) => quoteUuid(user.id)).join(',')
  return `select jsonb_build_object(
    'users', (select count(*) from auth.users where id in (${userIds})),
    'identities', (select count(distinct user_id) from auth.identities where user_id in (${userIds})),
    'owners', (select count(*) from public.app_users where user_id = ${quoteUuid(fixture.ownerUserId)}),
    'orphanOwners', (select count(*) from public.app_users as app_user left join auth.users as auth_user on auth_user.id = app_user.user_id where auth_user.id is null),
    'rlsEnabled', (select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class as relation join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace where namespace.nspname = 'public' and relation.relname = 'configuration_versions'),
    'rlsRows', (select count(*) from public.configuration_versions where id = ${quoteUuid(fixture.rlsRecordId)} and owner_id = ${quoteUuid(fixture.ownerUserId)})
  );`
}

export function validAuthOwnerClosure(value) {
  return (
    value?.users === 2 &&
    value?.identities === 2 &&
    value?.owners === 1 &&
    value?.orphanOwners === 0 &&
    value?.rlsEnabled === true &&
    value?.rlsRows === 1
  )
}

async function prepare(credentialsPath) {
  if (await exists(credentialsPath)) {
    throw new Error('Synthetic Auth credentials file must not already exist')
  }
  const databaseUrl = process.env.CAPITAL_LAB_DATABASE_URL
  if (!databaseUrl) throw new Error('Local source database URL is required')
  if ((await query(databaseUrl, 'select count(*) from auth.users;')) !== '0') {
    throw new Error('Synthetic source Auth fixture requires exactly zero users')
  }
  const status = await localStatus(null, 54321)
  const users = []
  for (let index = 0; index < 2; index += 1) {
    const email = `restore-${randomUUID()}@local.invalid`
    const password = randomBytes(36).toString('base64url')
    users.push({
      id: await adminCreateUser(status, email, password),
      email,
      password,
    })
  }
  const first = users[0]
  const rlsRecordId = randomUUID()
  const emailLiteral = first.email.replaceAll("'", "''")
  await query(
    databaseUrl,
    `insert into public.app_users (user_id, email, role, is_active)
values ('${first.id}'::uuid, '${emailLiteral}'::extensions.citext, 'owner', true);`,
  )
  await query(
    databaseUrl,
    `insert into public.configuration_versions (
      id, owner_id, config_kind, version, schema_version, name, config, content_hash
    ) values (
      '${rlsRecordId}'::uuid, '${first.id}'::uuid, 'experiment_defaults', 1, 1,
      'synthetic restore RLS fixture', '{"paper_only":true}'::jsonb,
      repeat('a', 64)
    );`,
  )
  const fixture = {
    schemaVersion: 2,
    users,
    ownerUserId: first.id,
    rlsRecordId,
  }
  if (
    !validAuthOwnerClosure(
      JSON.parse(await query(databaseUrl, authClosureSql(fixture))),
    )
  ) {
    throw new Error('Synthetic Auth and Owner-RLS closure is incomplete')
  }
  const bytes = Buffer.from(`${JSON.stringify(fixture)}\n`)
  await writeFile(credentialsPath, bytes, { mode: 0o600, flag: 'wx' })
  await chmod(credentialsPath, 0o600)
}

async function verify(credentialsPath, workdir) {
  const bytes = await readFile(credentialsPath)
  const fixture = validateSyntheticAuthFixture(
    JSON.parse(bytes.toString('utf8')),
  )
  const status = await localStatus(workdir, 55321)
  for (const [index, user] of fixture.users.entries()) {
    const response = await fetch(
      `${status.apiOrigin}/auth/v1/token?grant_type=password`,
      {
        body: JSON.stringify({ email: user.email, password: user.password }),
        headers: { 'Content-Type': 'application/json', apikey: status.anonKey },
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000),
      },
    )
    const body = await response.json().catch(() => null)
    if (
      response.status !== 200 ||
      body?.user?.id !== user.id ||
      typeof body?.access_token !== 'string'
    ) {
      throw new Error('Restored synthetic user cannot authenticate on stack B')
    }
    const dataResponse = await fetch(
      `${status.apiOrigin}/rest/v1/configuration_versions?id=eq.${encodeURIComponent(fixture.rlsRecordId)}&select=id,owner_id,name`,
      {
        headers: {
          Authorization: `Bearer ${body.access_token}`,
          apikey: status.anonKey,
        },
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000),
      },
    )
    const rows = await dataResponse.json().catch(() => null)
    if (
      dataResponse.status !== 200 ||
      !Array.isArray(rows) ||
      (index === 0 &&
        (rows.length !== 1 ||
          rows[0]?.id !== fixture.rlsRecordId ||
          rows[0]?.owner_id !== fixture.ownerUserId)) ||
      (index === 1 && rows.length !== 0)
    ) {
      throw new Error('Restored Owner-RLS allow/deny behavior differs')
    }
  }
  const targetUrl = process.env.CAPITAL_LAB_RESTORE_DATABASE_URL
  if (!targetUrl) throw new Error('Local restore database URL is required')
  if (
    !validAuthOwnerClosure(
      JSON.parse(await query(targetUrl, authClosureSql(fixture))),
    )
  ) {
    throw new Error('Restored Auth, identity, FK, or Owner-RLS closure differs')
  }
}

async function faults(credentialsPath, workdir) {
  await localStatus(workdir, 55321)
  const fixture = validateSyntheticAuthFixture(
    JSON.parse(await readFile(credentialsPath, 'utf8')),
  )
  const targetUrl = process.env.CAPITAL_LAB_RESTORE_DATABASE_URL
  if (!targetUrl) throw new Error('Local restore database URL is required')
  const mutations = [
    `delete from auth.identities where user_id = ${quoteUuid(fixture.users[1].id)};`,
    `set local session_replication_role = replica; update auth.users set id = gen_random_uuid() where id = ${quoteUuid(fixture.users[1].id)};`,
    `set local session_replication_role = replica; insert into public.app_users (user_id, email, role, is_active) values (gen_random_uuid(), 'orphan@local.invalid', 'owner', true);`,
    'set local session_replication_role = replica; delete from auth.identities; delete from auth.users;',
    'alter table public.configuration_versions disable row level security;',
  ]
  for (const mutation of mutations) {
    const observed = JSON.parse(
      await query(
        targetUrl,
        `begin; ${mutation} ${authClosureSql(fixture)} rollback;`,
      ),
    )
    if (validAuthOwnerClosure(observed)) {
      throw new Error('Auth/Owner fault injection was not detected')
    }
  }
}

async function main() {
  const requested = options()
  const workspace = await realpath(process.cwd())
  const credentialsPath =
    requested.mode === 'prepare'
      ? await newExternalPath(workspace, requested.credentials)
      : await verifiedExternalFile(workspace, requested.credentials)
  if (requested.mode === 'prepare') await prepare(credentialsPath)
  else {
    const workdir = await verifiedExternalDirectory(
      workspace,
      requested['supabase-workdir'],
    )
    if (requested.mode === 'verify') await verify(credentialsPath, workdir)
    else await faults(credentialsPath, workdir)
  }
  process.stdout.write(
    `${JSON.stringify({ status: requested.mode === 'prepare' ? 'synthetic_auth_created' : requested.mode === 'verify' ? 'synthetic_auth_login_and_rls_verified' : 'synthetic_auth_faults_detected', userCount: 2, rlsAllowCount: requested.mode === 'verify' ? 1 : null, rlsDenyCount: requested.mode === 'verify' ? 1 : null, secretValuesLogged: false })}\n`,
  )
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main().catch((error) => {
    console.error(
      error instanceof Error
        ? error.message
        : 'Local Auth fixture failed closed',
    )
    process.exit(1)
  })
}
