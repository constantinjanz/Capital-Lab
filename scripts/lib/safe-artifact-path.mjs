import { lstat, realpath } from 'node:fs/promises'
import path from 'node:path'

function normalized(value, platform = process.platform) {
  const implementation = platform === 'win32' ? path.win32 : path.posix
  const resolved = implementation.resolve(value)
  return platform === 'win32' ? resolved.toLowerCase() : resolved
}

export function pathIsInside(root, candidate, platform = process.platform) {
  const implementation = platform === 'win32' ? path.win32 : path.posix
  const relative = implementation.relative(
    normalized(root, platform),
    normalized(candidate, platform),
  )
  return (
    relative === '' ||
    (!relative.startsWith('..') && !implementation.isAbsolute(relative))
  )
}

export async function newExternalPath(workspace, requested) {
  const repository = await realpath(workspace)
  const resolved = path.resolve(requested)
  const parent = await realpath(path.dirname(resolved))
  if (pathIsInside(repository, parent)) {
    throw new Error('Sensitive artifact parent resolves inside the repository')
  }
  const candidate = path.join(parent, path.basename(resolved))
  try {
    await lstat(candidate)
    throw new Error('Sensitive artifact output must not already exist')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  return candidate
}

export async function verifyCreatedExternalPath(workspace, requested) {
  const repository = await realpath(workspace)
  const lexical = path.resolve(requested)
  const canonical = await realpath(lexical)
  if (
    pathIsInside(repository, canonical) ||
    normalized(lexical) !== normalized(canonical)
  ) {
    throw new Error(
      'Sensitive artifact path contains a symlink, junction, or repository alias',
    )
  }
  return canonical
}

export async function verifiedExternalFile(workspace, requested) {
  const repository = await realpath(workspace)
  const lexical = path.resolve(requested)
  const canonical = await realpath(lexical)
  const metadata = await lstat(lexical)
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    pathIsInside(repository, canonical) ||
    normalized(lexical) !== normalized(canonical)
  ) {
    throw new Error(
      'Sensitive artifact file is not a canonical external regular file',
    )
  }
  return canonical
}

export async function verifiedDirectChild(directory, requested) {
  const parent = await realpath(directory)
  const lexical = path.resolve(requested)
  const canonical = await realpath(lexical)
  const metadata = await lstat(lexical)
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    path.dirname(canonical) !== parent ||
    normalized(lexical) !== normalized(canonical)
  ) {
    throw new Error('Sensitive artifact is not a canonical direct child')
  }
  return canonical
}
