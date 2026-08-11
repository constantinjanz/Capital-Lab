import { mkdir, readdir, rename, rmdir } from 'node:fs/promises'
import path from 'node:path'

export async function withHeldFiles(files, holdDirectory, operation) {
  if (
    !Array.isArray(files) ||
    files.length === 0 ||
    new Set(files.map((file) => file.name)).size !== files.length ||
    files.some(
      (file) =>
        !file ||
        typeof file.name !== 'string' ||
        path.basename(file.name) !== file.name ||
        typeof file.source !== 'string',
    ) ||
    typeof holdDirectory !== 'string' ||
    typeof operation !== 'function'
  ) {
    throw new Error('Held-file contract is invalid')
  }

  const moved = []
  let operationFailed = false
  let operationError
  let result
  await mkdir(holdDirectory)
  try {
    for (const file of files) {
      const held = path.join(holdDirectory, file.name)
      await rename(file.source, held)
      moved.push({ ...file, held })
    }
    result = await operation(moved)
  } catch (error) {
    operationFailed = true
    operationError = error
  } finally {
    const restorationErrors = []
    for (const file of moved.reverse()) {
      try {
        await rename(file.held, file.source)
      } catch (error) {
        restorationErrors.push(error)
      }
    }
    try {
      if ((await readdir(holdDirectory)).length === 0) {
        await rmdir(holdDirectory)
      } else {
        restorationErrors.push(
          new Error('Migration hold directory is not empty'),
        )
      }
    } catch (error) {
      restorationErrors.push(error)
    }
    if (restorationErrors.length > 0) {
      throw new AggregateError(
        operationFailed
          ? [operationError, ...restorationErrors]
          : restorationErrors,
        'Every moved migration file must be restored',
      )
    }
  }
  if (operationFailed) throw operationError
  return result
}
