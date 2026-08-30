import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const CLOSURE = Object.freeze([
  'package.json',
  'scripts/lib/canonical-repository-bytes.mjs',
  'scripts/lib/safe-process.mjs',
  'scripts/run-emergency-bootstrap.mjs',
  'scripts/run-emergency-kill.mjs',
  'supabase/activation/emergency-kill.sql',
])

function fail(message) {
  throw new Error(message)
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function option(name) {
  const prefix = `--${name}=`
  const values = process.argv.filter((argument) => argument.startsWith(prefix))
  return values.length === 1 ? values[0].slice(prefix.length) : undefined
}

async function exactNativeGit(value) {
  if (!path.isAbsolute(value ?? '')) fail('Trusted Git executable is required')
  const canonical = await realpath(value)
  const metadata = await lstat(canonical)
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    path.basename(canonical).toLowerCase() !==
      (process.platform === 'win32' ? 'git.exe' : 'git')
  ) {
    fail('Trusted Git executable identity is invalid')
  }
  return canonical
}

function git(gitExecutable, repository, args, encoding = 'utf8') {
  const result = spawnSync(gitExecutable, args, {
    cwd: repository,
    encoding,
    shell: false,
    windowsHide: true,
    timeout: 15_000,
  })
  if (
    result.status !== 0 ||
    result.signal ||
    result.error ||
    result.status === null
  ) {
    fail('Committed emergency bootstrap evidence is unavailable')
  }
  return result.stdout
}

async function assertRegularRepositoryPath(repository, relativePath) {
  const absolute = path.join(repository, ...relativePath.split('/'))
  const relative = path.relative(repository, absolute)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    fail('Emergency bootstrap dependency escaped the repository')
  }
  let current = repository
  for (const component of relative.split(path.sep)) {
    current = path.join(current, component)
    const metadata = await lstat(current)
    if (metadata.isSymbolicLink()) {
      fail('Emergency bootstrap dependency contains a link or junction')
    }
  }
  if (path.normalize(await realpath(absolute)) !== path.normalize(absolute)) {
    fail('Emergency bootstrap dependency canonical path drifted')
  }
  return absolute
}

async function committedClosure(gitExecutable, repository) {
  const head = git(gitExecutable, repository, ['rev-parse', 'HEAD']).trim()
  if (!/^[0-9a-f]{40}$/u.test(head)) fail('Emergency bootstrap HEAD is invalid')
  const blobs = new Map()
  for (const relativePath of CLOSURE) {
    const absolute = await assertRegularRepositoryPath(repository, relativePath)
    const tree = git(gitExecutable, repository, [
      'ls-tree',
      'HEAD',
      '--',
      relativePath,
    ])
    if (!/^100(?:644|755) blob [0-9a-f]{40}\t/u.test(tree)) {
      fail('Emergency bootstrap dependency is not a committed regular file')
    }
    const blob = git(
      gitExecutable,
      repository,
      ['show', `HEAD:${relativePath}`],
      'buffer',
    )
    if (digest(blob) !== digest(await readFile(absolute))) {
      fail('Emergency bootstrap dependency differs from committed HEAD')
    }
    blobs.set(relativePath, blob)
  }
  return { blobs, head }
}

async function main() {
  if (process.argv.length !== 5) fail('Unknown emergency bootstrap arguments')
  const gitExecutable = await exactNativeGit(option('git-executable'))
  const campaignId = option('campaign-id')
  const confirmation = option('confirm')
  if (!campaignId || !confirmation)
    fail('Emergency bootstrap arguments are incomplete')
  const repository = await realpath(process.cwd())
  const evidence = await committedClosure(gitExecutable, repository)
  const staging = await realpath(
    await mkdtemp(path.join(tmpdir(), 'capital-lab-emergency-committed-')),
  )
  try {
    await chmod(staging, 0o700)
    for (const [relativePath, bytes] of evidence.blobs) {
      const destination = path.join(staging, ...relativePath.split('/'))
      await mkdir(path.dirname(destination), { recursive: true })
      await writeFile(destination, bytes, { mode: 0o600, flag: 'wx' })
    }
    const result = spawnSync(
      process.execPath,
      [
        path.join(staging, 'scripts', 'run-emergency-kill.mjs'),
        `--campaign-id=${campaignId}`,
        `--confirm=${confirmation}`,
      ],
      {
        cwd: repository,
        env: process.env,
        shell: false,
        stdio: 'inherit',
        timeout: 30_000,
        windowsHide: true,
      },
    )
    if (result.error || result.signal || result.status === null) process.exit(3)
    process.exit(result.status ?? 3)
  } finally {
    await rm(staging, { force: true, recursive: true })
  }
}

await main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.message
      : 'Emergency bootstrap failed closed',
  )
  process.exit(2)
})
