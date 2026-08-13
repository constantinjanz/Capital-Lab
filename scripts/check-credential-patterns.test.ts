import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import {
  resolvedArguments,
  resolveNativeExecutable,
} from './lib/safe-process.mjs'

const scanner = fileURLToPath(
  new URL('./check-credential-patterns.mjs', import.meta.url),
)
const git = resolveNativeExecutable('git')
const cleanup: string[] = []
const syntheticCredential = [
  'postgresql',
  '://fixture-owner:',
  'fixture-password',
  '@127.0.0.1:54322/fixture_db',
].join('')

afterEach(async () => {
  while (cleanup.length > 0) {
    await rm(cleanup.pop()!, { force: true, recursive: true })
  }
})

function runGit(root: string, args: string[]) {
  const result = spawnSync(git.command, resolvedArguments(git, args), {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  })
  if (result.status !== 0) {
    throw new Error(`Temporary Git fixture failed: ${args[0]}`)
  }
  return result.stdout.trim()
}

async function createRepository() {
  const root = await mkdtemp(path.join(tmpdir(), 'credential-history-'))
  cleanup.push(root)
  runGit(root, ['init'])
  runGit(root, ['config', 'user.name', 'Credential Scanner Fixture'])
  runGit(root, ['config', 'user.email', 'fixture@example.invalid'])
  await writeFile(path.join(root, 'fixture.txt'), 'clean\n')
  runGit(root, ['add', 'fixture.txt'])
  runGit(root, ['commit', '-m', 'base'])
  return root
}

function scan(root: string, assertedHeadSha?: string) {
  const baseEnv = { ...process.env }
  delete baseEnv.CAPITAL_LAB_CI_COMMIT_SHA
  return spawnSync(process.execPath, [scanner], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...baseEnv,
      ...(assertedHeadSha === undefined
        ? {}
        : { CAPITAL_LAB_CI_COMMIT_SHA: assertedHeadSha }),
    },
    shell: false,
    windowsHide: true,
  })
}

async function commitFixture(root: string, content: string, message: string) {
  await writeFile(path.join(root, 'fixture.txt'), `${content}\n`)
  runGit(root, ['add', 'fixture.txt'])
  runGit(root, ['commit', '-m', message])
}

describe('credential scanner verified-head history scope', () => {
  it('detects a credential in a true ancestor without printing its value', async () => {
    const root = await createRepository()
    await commitFixture(root, syntheticCredential, 'ancestor fixture')
    await commitFixture(root, 'clean again', 'checked head')

    const result = scan(root, runGit(root, ['rev-parse', 'HEAD']))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('CRED-008')
    expect(result.stderr).not.toContain(syntheticCredential)
  })

  it('ignores the same fixture on a divergent sibling branch', async () => {
    const root = await createRepository()
    const baseSha = runGit(root, ['rev-parse', 'HEAD'])
    runGit(root, ['switch', '-c', 'sibling'])
    await commitFixture(root, syntheticCredential, 'divergent fixture')
    runGit(root, ['switch', '-c', 'checked', baseSha])
    await commitFixture(root, 'checked branch stays clean', 'checked head')
    const headSha = runGit(root, ['rev-parse', 'HEAD'])

    const result = scan(root, headSha)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('bounded Git-history commits')
    expect(result.stdout).not.toContain(syntheticCredential)
    expect(result.stderr).not.toContain(syntheticCredential)
  })

  it('still detects a credential in the current working tree', async () => {
    const root = await createRepository()
    await writeFile(path.join(root, 'fixture.txt'), `${syntheticCredential}\n`)

    const result = scan(root)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('CRED-008')
    expect(result.stderr).not.toContain(syntheticCredential)
  })

  it('fails closed for invalid and mismatched CI commit assertions', async () => {
    const root = await createRepository()
    const headSha = runGit(root, ['rev-parse', 'HEAD'])
    const invalid = scan(root, 'not-a-full-commit-sha')
    const mismatched = scan(
      root,
      `${headSha.slice(0, 39)}${headSha.endsWith('0') ? '1' : '0'}`,
    )

    expect(invalid.status).toBe(1)
    expect(invalid.stderr).toContain('does not match Git HEAD')
    expect(mismatched.status).toBe(1)
    expect(mismatched.stderr).toContain('does not match Git HEAD')
  })
})
