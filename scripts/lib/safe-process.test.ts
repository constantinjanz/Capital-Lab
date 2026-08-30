import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { resolveNativeExecutable, resolvedArguments } from './safe-process.mjs'

function fixtureDirectory(name: string) {
  const directory = path.join(tmpdir(), `capital-lab-safe-process-${name}`)
  mkdirSync(directory, { recursive: true })
  return directory
}

describe('native subprocess resolution', () => {
  it('uses native corepack.exe for pnpm on Windows without shell mediation', () => {
    const directory = fixtureDirectory('corepack')
    writeFileSync(path.join(directory, 'corepack.exe'), 'fixture')
    const resolved = resolveNativeExecutable('pnpm', {
      platform: 'win32',
      pathValue: directory,
      execPath: process.execPath,
    })
    expect(path.basename(resolved.command).toLowerCase()).toBe('corepack.exe')
    expect(resolvedArguments(resolved, ['test', '--runInBand'])).toEqual([
      'pnpm',
      'test',
      '--runInBand',
    ])
  })

  it('refuses command shims, metacharacter commands, and implicit interpolation', () => {
    const directory = fixtureDirectory('refuse-shims')
    writeFileSync(path.join(directory, 'supabase.cmd'), 'fixture')
    expect(() =>
      resolveNativeExecutable('supabase', {
        platform: 'win32',
        pathValue: directory,
      }),
    ).toThrow('supabase.exe')
    expect(() => resolveNativeExecutable('pnpm & whoami')).toThrow(
      'allowlisted',
    )
    expect(() =>
      resolvedArguments({ command: 'x', prefixArgs: [] }, ['ok', 1]),
    ).toThrow('explicit string array')
  })
})
