import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { withHeldFiles } from './held-files.mjs'

describe('fault-safe migration holding', () => {
  it('restores every moved byte after a fault in the first destructive operation', async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), 'capital-lab-held-files-'),
    )
    const first = path.join(root, '20260809150000_first.sql')
    const second = path.join(root, '20260809150417_second.sql')
    const hold = path.join(root, 'hold')
    await writeFile(first, 'first\r\n')
    await writeFile(second, 'second\n')

    await expect(
      withHeldFiles(
        [
          { name: path.basename(first), source: first },
          { name: path.basename(second), source: second },
        ],
        hold,
        async () => {
          throw new Error('injected reset fault')
        },
      ),
    ).rejects.toThrow('injected reset fault')
    expect(await readFile(first, 'utf8')).toBe('first\r\n')
    expect(await readFile(second, 'utf8')).toBe('second\n')
    await rm(root, { recursive: true, force: true })
  })
})
