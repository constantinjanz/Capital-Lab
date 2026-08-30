import { spawnSync } from 'node:child_process'
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  classifyEmergencyProcessResult,
  emergencyDependencyClosure,
  validateEmergencyConfirmation,
  validateEmergencyTarget,
  verifyEmergencyDependencies,
} from './run-emergency-kill.mjs'
import {
  resolvedArguments,
  resolveNativeExecutable,
} from './lib/safe-process.mjs'

const campaignId = '11111111-1111-4111-8111-111111111111'
const direct =
  'postgresql://postgres:opaque@db.qrnuyibntcxwffrxmrvn.supabase.co:5432/postgres?sslmode=verify-full'
const cleanup: string[] = []

afterEach(async () => {
  while (cleanup.length > 0) {
    await rm(cleanup.pop()!, { force: true, recursive: true })
  }
})

function git(repository: string, args: string[]) {
  const executable = resolveNativeExecutable('git')
  const result = spawnSync(
    executable.command,
    resolvedArguments(executable, args),
    { cwd: repository, encoding: 'utf8', shell: false, windowsHide: true },
  )
  if (result.status !== 0 || result.signal || result.error) {
    throw new Error('Temporary emergency Git fixture failed')
  }
}

async function emergencyRepositoryFixture() {
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), 'capital-lab-emergency-')),
  )
  cleanup.push(root)
  const closure = await emergencyDependencyClosure(process.cwd())
  for (const relativePath of closure) {
    const target = path.join(root, relativePath)
    await mkdir(path.dirname(target), { recursive: true })
    await copyFile(path.join(process.cwd(), relativePath), target)
  }
  git(root, ['init'])
  git(root, ['config', 'core.autocrlf', 'false'])
  git(root, ['config', 'user.email', 'fixture@local.invalid'])
  git(root, ['config', 'user.name', 'Capital Lab Fixture'])
  git(root, ['add', '--', '.'])
  git(root, ['commit', '-m', 'fixture'])
  return { closure, root }
}

describe('minimal DB-first emergency runner', () => {
  it('needs only an exact campaign-scoped confirmation, not a Campaign manifest or Vercel', () => {
    expect(
      validateEmergencyConfirmation(
        campaignId,
        `EMERGENCY KILL CAPITAL LAB CAMPAIGN ${campaignId}`,
      ),
    ).toContain(campaignId)
    expect(() =>
      validateEmergencyConfirmation(campaignId, 'EMERGENCY KILL'),
    ).toThrow()
  })

  it('permits unrelated dirty files while raw-checking the complete transitive closure', async () => {
    const closure = await emergencyDependencyClosure(process.cwd())
    expect(closure).toEqual([
      'package.json',
      'scripts/lib/canonical-repository-bytes.mjs',
      'scripts/lib/safe-process.mjs',
      'scripts/run-emergency-bootstrap.mjs',
      'scripts/run-emergency-kill.mjs',
      'supabase/activation/emergency-kill.sql',
    ])
    const source = await readFile('scripts/run-emergency-kill.mjs', 'utf8')
    expect(source).not.toContain("git(['status'")
    expect(source).not.toMatch(/campaign manifest|vercel/iu)
    expect(source).toContain("['show', `HEAD:${relativePath}`]")
    expect(source).toContain('isSymbolicLink()')
  })

  it('rejects modified, missing, untracked-in-closure, and linked dependencies while allowing unrelated dirt', async () => {
    const { root } = await emergencyRepositoryFixture()
    await writeFile(path.join(root, 'unrelated.txt'), 'dirty but unrelated\n')
    await expect(verifyEmergencyDependencies(root)).resolves.toMatchObject({
      headSha: expect.stringMatching(/^[0-9a-f]{40}$/u),
    })

    const helper = path.join(root, 'scripts', 'lib', 'safe-process.mjs')
    const originalHelper = await readFile(helper)
    await writeFile(helper, Buffer.concat([originalHelper, Buffer.from('\n')]))
    await expect(verifyEmergencyDependencies(root)).rejects.toThrow(
      /differs from committed HEAD/,
    )
    await writeFile(helper, originalHelper)

    const sql = path.join(root, 'supabase', 'activation', 'emergency-kill.sql')
    const originalSql = await readFile(sql)
    await rm(sql)
    await expect(verifyEmergencyDependencies(root)).rejects.toThrow()
    await writeFile(sql, originalSql)

    git(root, [
      'rm',
      '--cached',
      '--',
      'supabase/activation/emergency-kill.sql',
    ])
    git(root, ['commit', '-m', 'remove emergency SQL from HEAD'])
    await expect(verifyEmergencyDependencies(root)).rejects.toThrow(
      /not a committed regular file/,
    )

    const linkedFixture = await emergencyRepositoryFixture()
    const linkedRoot = linkedFixture.root
    const external = await realpath(
      await mkdtemp(path.join(tmpdir(), 'capital-lab-linked-lib-')),
    )
    cleanup.push(external)
    await copyFile(
      path.join(linkedRoot, 'scripts', 'lib', 'safe-process.mjs'),
      path.join(external, 'safe-process.mjs'),
    )
    await copyFile(
      path.join(linkedRoot, 'scripts', 'lib', 'canonical-repository-bytes.mjs'),
      path.join(external, 'canonical-repository-bytes.mjs'),
    )
    await rm(path.join(linkedRoot, 'scripts', 'lib'), { recursive: true })
    await symlink(
      external,
      path.join(linkedRoot, 'scripts', 'lib'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    await expect(verifyEmergencyDependencies(linkedRoot)).rejects.toThrow(
      /symlink or junction/,
    )
  }, 20_000)

  it('rejects a modified package launcher before any runner or database action', async () => {
    const { root } = await emergencyRepositoryFixture()
    const packagePath = path.join(root, 'package.json')
    await writeFile(
      packagePath,
      '{"scripts":{"activation:emergency-kill":"unsafe-worktree-launcher"}}\n',
    )
    const gitExecutable = resolveNativeExecutable('git')
    const committedBootstrap = spawnSync(
      gitExecutable.command,
      resolvedArguments(gitExecutable, [
        'show',
        'HEAD:scripts/run-emergency-bootstrap.mjs',
      ]),
      {
        cwd: root,
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
      },
    )
    expect(committedBootstrap.status).toBe(0)
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-',
        `--git-executable=${gitExecutable.command}`,
        `--campaign-id=${campaignId}`,
        `--confirm=EMERGENCY KILL CAPITAL LAB CAMPAIGN ${campaignId}`,
      ],
      {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, CAPITAL_LAB_DATABASE_URL: direct },
        input: committedBootstrap.stdout,
        shell: false,
        timeout: 20_000,
        windowsHide: true,
      },
    )
    expect(result.status).toBe(2)
    expect(result.stderr).toContain(
      'Emergency bootstrap dependency differs from committed HEAD',
    )
  }, 20_000)

  it('accepts only the exact TLS-verified project boundary', () => {
    expect(validateEmergencyTarget(direct)).toBe('direct')
    for (const invalid of [
      direct.replace('verify-full', 'require'),
      direct.replace(':opaque@', ':@'),
      direct.replace('qrnuyibntcxwffrxmrvn', 'aaaaaaaaaaaaaaaaaaaa'),
      direct.replace(':5432/', ':6543/'),
      direct.replace('/postgres?', '/other?'),
      `${direct}&application_name=override`,
    ]) {
      expect(() => validateEmergencyTarget(invalid)).toThrow()
    }
  })

  it('reports timeout, signal, and spawn ambiguity as unknown without retrying', () => {
    expect(
      classifyEmergencyProcessResult({
        code: null,
        signal: null,
        timedOut: true,
        error: null,
      }),
    ).toEqual({
      outcome: 'unknown',
      exitCode: null,
      signal: null,
      timedOut: true,
    })
    expect(
      classifyEmergencyProcessResult({
        code: 0,
        signal: null,
        timedOut: false,
        error: null,
      }).outcome,
    ).toBe('completed')
  })
})
