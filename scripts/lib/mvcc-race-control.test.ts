import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  loadMvccRaceControl,
  signalMvccMarker,
  waitForMvccMarker,
} from './mvcc-race-control.mjs'

const cleanup: string[] = []
const originalControl = process.env.CAPITAL_LAB_LOCAL_MVCC_RACE_CONTROL
const originalRunId = process.env.CAPITAL_LAB_LOCAL_MVCC_RACE_ID

afterEach(async () => {
  if (originalControl === undefined)
    delete process.env.CAPITAL_LAB_LOCAL_MVCC_RACE_CONTROL
  else process.env.CAPITAL_LAB_LOCAL_MVCC_RACE_CONTROL = originalControl
  if (originalRunId === undefined)
    delete process.env.CAPITAL_LAB_LOCAL_MVCC_RACE_ID
  else process.env.CAPITAL_LAB_LOCAL_MVCC_RACE_ID = originalRunId
  while (cleanup.length > 0)
    await rm(cleanup.pop()!, { force: true, recursive: true })
})

describe('external MVCC race barriers', () => {
  it('persists exact run-bound markers outside the repository', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'capital-lab-mvcc-'))
    cleanup.push(root)
    const repository = path.join(root, 'repository')
    const controlPath = path.join(root, 'control')
    await mkdir(repository)
    await mkdir(controlPath)
    process.env.CAPITAL_LAB_LOCAL_MVCC_RACE_CONTROL = controlPath
    process.env.CAPITAL_LAB_LOCAL_MVCC_RACE_ID = 'run-test-123456'
    const control = await loadMvccRaceControl(repository)
    expect(control).not.toBeNull()
    await signalMvccMarker(repository, control!, 'snapshot-ready')
    await expect(
      waitForMvccMarker(control!, 'snapshot-ready'),
    ).resolves.toBeUndefined()
  })

  it('rejects repository-internal controls and changed marker identities', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'capital-lab-mvcc-'))
    cleanup.push(root)
    const repository = path.join(root, 'repository')
    const internal = path.join(repository, 'control')
    const external = path.join(root, 'external')
    await mkdir(internal, { recursive: true })
    await mkdir(external)
    process.env.CAPITAL_LAB_LOCAL_MVCC_RACE_CONTROL = internal
    process.env.CAPITAL_LAB_LOCAL_MVCC_RACE_ID = 'run-test-123456'
    await expect(loadMvccRaceControl(repository)).rejects.toThrow(
      /external directory/,
    )
    process.env.CAPITAL_LAB_LOCAL_MVCC_RACE_CONTROL = external
    const control = await loadMvccRaceControl(repository)
    await writeFile(path.join(external, 'mutation-visible'), 'run-forged\n')
    await expect(
      waitForMvccMarker(control!, 'mutation-visible'),
    ).rejects.toThrow(/identity differs/)
  })
})
