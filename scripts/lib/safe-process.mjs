import {
  accessSync,
  constants,
  existsSync,
  realpathSync,
  statSync,
} from 'node:fs'
import path from 'node:path'

const ALLOWED_EXECUTABLES = new Set([
  'docker',
  'git',
  'node',
  'pg_dump',
  'pg_dumpall',
  'pg_restore',
  'pnpm',
  'psql',
  'supabase',
])

function executableFile(filename, platform = process.platform) {
  try {
    const stats = statSync(filename)
    if (!stats.isFile()) return false
    if (platform !== 'win32') {
      accessSync(filename, constants.X_OK)
    }
    return true
  } catch {
    return false
  }
}

function pathEntries(pathValue, platform) {
  return String(pathValue ?? '')
    .split(platform === 'win32' ? ';' : ':')
    .filter(Boolean)
    .map((entry) => path.resolve(entry.replace(/^"|"$/gu, '')))
}

function locate(filename, options) {
  for (const directory of pathEntries(options.pathValue, options.platform)) {
    const candidate = path.join(directory, filename)
    if (!existsSync(candidate) || !executableFile(candidate, options.platform))
      continue
    return realpathSync.native(candidate)
  }
  return null
}

export function resolveNativeExecutable(
  name,
  {
    platform = process.platform,
    pathValue = process.env.PATH,
    execPath = process.execPath,
  } = {},
) {
  if (!ALLOWED_EXECUTABLES.has(name)) {
    throw new Error('Subprocess executable is not allowlisted')
  }
  if (name === 'node') {
    const resolved = realpathSync.native(execPath)
    if (!executableFile(resolved))
      throw new Error('Node executable is unavailable')
    return { command: resolved, prefixArgs: [] }
  }
  if (platform === 'win32' && name === 'pnpm') {
    const corepack = locate('corepack.exe', { platform, pathValue })
    if (!corepack) {
      throw new Error('Native corepack.exe is required for pnpm on Windows')
    }
    return { command: corepack, prefixArgs: ['pnpm'] }
  }
  const filename = platform === 'win32' ? `${name}.exe` : name
  const command = locate(filename, { platform, pathValue })
  if (!command) {
    throw new Error(`Native ${filename} executable is unavailable`)
  }
  return { command, prefixArgs: [] }
}

export function resolvedArguments(resolved, args) {
  if (
    !Array.isArray(args) ||
    args.some((argument) => typeof argument !== 'string')
  ) {
    throw new Error('Subprocess arguments must be an explicit string array')
  }
  return [...resolved.prefixArgs, ...args]
}
