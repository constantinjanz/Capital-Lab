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
  verifiedExternalDirectory,
  verifiedExternalFile,
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
    expect(await verifiedExternalDirectory(repository, candidate)).toBe(
      await realpath(candidate),
    )
    const artifact = path.join(candidate, 'manifest.json')
    await writeFile(artifact, '{}\n')
    expect(await verifiedExternalFile(repository, artifact)).toBe(
      await realpath(artifact),
    )
    expect(await verifiedDirectChild(candidate, artifact)).toBe(
      await realpath(artifact),
    )
  })

  it('rejects sensitive files and directories inside the repository', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'capital-lab-inside-'))
    cleanup.push(root)
    const repository = path.join(root, 'repository')
    const directory = path.join(repository, 'artifacts')
    const artifact = path.join(directory, 'auth.json')
    await mkdir(directory, { recursive: true })
    await writeFile(artifact, '{}\n')
    await expect(
      verifiedExternalDirectory(repository, directory),
    ).rejects.toThrow(/external directory/)
    await expect(verifiedExternalFile(repository, artifact)).rejects.toThrow(
      /external regular file/,
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
