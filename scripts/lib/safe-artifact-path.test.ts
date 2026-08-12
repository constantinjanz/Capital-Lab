import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  newExternalPath,
  pathIsInside,
  verifiedDirectChild,
  verifyCreatedExternalPath,
} from './safe-artifact-path.mjs'

const cleanup: string[] = []
afterEach(async () => {
  while (cleanup.length > 0)
    await rm(cleanup.pop()!, { force: true, recursive: true })
})

describe('canonical sensitive artifact paths', () => {
  it('treats Windows case variants as the same boundary', () => {
    expect(pathIsInside('C:\\Repo', 'c:\\repo\\artifact', 'win32')).toBe(true)
  })

  it('accepts a new external directory and its direct regular files', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'capital-lab-path-'))
    cleanup.push(root)
    const repository = path.join(root, 'repository')
    const external = path.join(root, 'external')
    await mkdir(repository)
    await mkdir(external)
    const candidate = await newExternalPath(
      repository,
      path.join(external, 'backup'),
    )
    await mkdir(candidate)
    expect(await verifyCreatedExternalPath(repository, candidate)).toBe(
      await realpath(candidate),
    )
    const artifact = path.join(candidate, 'manifest.json')
    await writeFile(artifact, '{}\n')
    expect(await verifiedDirectChild(candidate, artifact)).toBe(
      await realpath(artifact),
    )
  })

  it('rejects POSIX symlinks and Windows junction aliases into the repository', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'capital-lab-link-'))
    cleanup.push(root)
    const repository = path.join(root, 'repository')
    const external = path.join(root, 'external')
    await mkdir(repository)
    await mkdir(external)
    const alias = path.join(external, 'alias')
    await symlink(
      repository,
      alias,
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    await expect(
      newExternalPath(repository, path.join(alias, 'backup')),
    ).rejects.toThrow(/inside the repository/)
  })
})
