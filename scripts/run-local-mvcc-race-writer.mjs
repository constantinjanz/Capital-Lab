import { realpath } from 'node:fs/promises'

import { ownedPsql } from './lib/local-container-postgres.mjs'
import {
  loadMvccRaceControl,
  signalMvccMarker,
  waitForMvccMarker,
} from './lib/mvcc-race-control.mjs'
const FIXTURE_KEY = 'local_mvcc_race_fixture_v1'

async function main() {
  const workspace = await realpath(process.cwd())
  const control = await loadMvccRaceControl(workspace)
  if (!control)
    throw new Error('Local MVCC writer requires exact control input')
  let inserted = false
  try {
    await waitForMvccMarker(control, 'snapshot-ready')
    const insertedCount = await ownedPsql(
      'source',
      `insert into private.application_settings (owner_id, setting_key, value, is_secret)
select user_id, '${FIXTURE_KEY}', 'false'::jsonb, false
from public.app_users order by user_id limit 1
returning 1;`,
    )
    if (insertedCount !== '1') {
      throw new Error(
        'Local MVCC writer did not insert exactly one fixture row',
      )
    }
    inserted = true
    await signalMvccMarker(workspace, control, 'mutation-visible')
    await waitForMvccMarker(control, 'dumps-complete')
  } finally {
    if (inserted) {
      const deletedCount = await ownedPsql(
        'source',
        `delete from private.application_settings
where setting_key = '${FIXTURE_KEY}' returning 1;`,
      )
      if (deletedCount !== '1') {
        throw new Error('Local MVCC writer cleanup did not remove its fixture')
      }
      await signalMvccMarker(workspace, control, 'source-restored')
    }
  }
  process.stdout.write(
    `${JSON.stringify({ status: 'local_mvcc_race_completed', sourceRestored: true })}\n`,
  )
}

await main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : 'Local MVCC writer failed closed',
  )
  process.exit(1)
})
