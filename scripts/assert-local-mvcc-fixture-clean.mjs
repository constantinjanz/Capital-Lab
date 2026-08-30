import { ownedPsql } from './lib/local-container-postgres.mjs'

const count = await ownedPsql(
  'source',
  `select count(*) from private.application_settings
where setting_key = 'local_mvcc_race_fixture_v1';`,
)
if (count !== '0') {
  throw new Error('Local MVCC fixture cleanup evidence differs')
}
process.stdout.write(
  `${JSON.stringify({ status: 'local_mvcc_fixture_absent' })}\n`,
)
