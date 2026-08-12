import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  newExternalPath,
  verifiedDirectChild,
  verifiedExternalDirectory,
} from './safe-artifact-path.mjs'

const WAIT_TIMEOUT_MS = 60_000
const POLL_MS = 50
const MARKERS = new Set([
  'snapshot-ready',
  'mutation-visible',
  'dumps-complete',
  'source-restored',
])

function validateMarker(marker) {
  if (!MARKERS.has(marker)) throw new Error('MVCC barrier marker is invalid')
  return marker
}

function validateRunId(runId) {
  if (!/^run-[a-z0-9][a-z0-9-]{5,80}$/u.test(runId ?? '')) {
    throw new Error('MVCC barrier run identity is invalid')
  }
  return runId
}

export async function loadMvccRaceControl(workspace) {
  const requested = process.env.CAPITAL_LAB_LOCAL_MVCC_RACE_CONTROL
  const runId = process.env.CAPITAL_LAB_LOCAL_MVCC_RACE_ID
  if (!requested && !runId) return null
  if (!requested || !runId) {
    throw new Error('MVCC race control requires both external path and run ID')
  }
  return {
    directory: await verifiedExternalDirectory(workspace, requested),
    runId: validateRunId(runId),
  }
}

export async function signalMvccMarker(workspace, control, marker) {
  const filename = await newExternalPath(
    workspace,
    path.join(control.directory, validateMarker(marker)),
  )
  await writeFile(filename, `${control.runId}\n`, { mode: 0o600, flag: 'wx' })
}

export async function waitForMvccMarker(control, marker) {
  const filename = path.join(control.directory, validateMarker(marker))
  const deadline = Date.now() + WAIT_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const canonical = await verifiedDirectChild(control.directory, filename)
      if ((await readFile(canonical, 'utf8')) !== `${control.runId}\n`) {
        throw new Error('MVCC barrier marker identity differs')
      }
      return
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
  throw new Error('MVCC barrier timed out with an unknown export outcome')
}
