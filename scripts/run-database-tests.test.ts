import { describe, expect, it, vi } from 'vitest'

import {
  classifyDatabaseProcessResult,
  runDatabaseTests,
} from './run-database-tests.mjs'

function resolver(name: string) {
  return { command: `C:\\native\\${name}.exe`, prefixArgs: [] }
}

describe('native local database test runner', () => {
  it('runs exact native commands without a shell and with bounded timeouts', () => {
    const spawn = vi.fn((...arguments_: unknown[]) => {
      void arguments_
      return { error: undefined, signal: null, status: 0 }
    })
    expect(
      runDatabaseTests({
        resolveExecutable: resolver,
        spawn: spawn as never,
      }),
    ).toBe(0)
    expect(spawn.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      [
        'C:\\native\\docker.exe',
        ['version', '--format', '{{.Server.Version}}'],
      ],
      ['C:\\native\\supabase.exe', ['--version']],
      ['C:\\native\\supabase.exe', ['db', 'reset']],
      ['C:\\native\\supabase.exe', ['test', 'db']],
    ])
    for (const call of spawn.mock.calls) {
      expect(call[2] as object).toMatchObject({
        shell: false,
        windowsHide: true,
      })
      expect((call[2] as { timeout: number }).timeout).toBeGreaterThan(0)
    }
  })

  it('stops before reset when Docker is unavailable', () => {
    const spawn = vi.fn()
    expect(
      runDatabaseTests({
        resolveExecutable(name: string) {
          if (name === 'docker') throw new Error('missing')
          return resolver(name)
        },
        spawn,
      }),
    ).toBe(2)
    expect(spawn).not.toHaveBeenCalled()
  })

  it('treats timeout, signal, and spawn ambiguity as unknown and never continues', () => {
    for (const result of [
      { error: new Error('spawn'), signal: null, status: null },
      { error: undefined, signal: 'SIGTERM', status: null },
      { error: undefined, signal: null, status: null },
    ]) {
      expect(classifyDatabaseProcessResult(result)).toEqual({
        exitCode: 3,
        outcome: 'unknown',
      })
      const spawn = vi.fn((...arguments_: unknown[]) => {
        void arguments_
        return result
      })
      expect(
        runDatabaseTests({
          resolveExecutable: resolver,
          spawn: spawn as never,
        }),
      ).toBe(3)
      expect(spawn).toHaveBeenCalledTimes(1)
    }
  })

  it('does not run pgTAP after a failed reset', () => {
    const spawn = vi
      .fn()
      .mockReturnValueOnce({ signal: null, status: 0 })
      .mockReturnValueOnce({ signal: null, status: 0 })
      .mockReturnValueOnce({ signal: null, status: 7 })
    expect(runDatabaseTests({ resolveExecutable: resolver, spawn })).toBe(7)
    expect(spawn).toHaveBeenCalledTimes(3)
  })
})
