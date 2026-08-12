import path from 'node:path'

import {
  loadCriticalRelationContract,
  loadSchemaGolden,
} from './critical-backup-contract.mjs'

for (const [short, kind] of [
  ['pre', 'pre_activation'],
  ['post', 'post_activation'],
]) {
  const contractPath = path.join(
    process.cwd(),
    'supabase',
    'backup',
    `${short}-activation.v1.json`,
  )
  const { sha256: relationContractSha256 } = await loadCriticalRelationContract(
    contractPath,
    kind,
  )
  await loadSchemaGolden(
    path.join(
      process.cwd(),
      'supabase',
      'backup',
      `${short}-activation.schema-golden.v2.json`,
    ),
    kind,
    relationContractSha256,
  )
}

process.stdout.write(
  `${JSON.stringify({ status: 'committed_schema_goldens_verified', contractCount: 2 })}\n`,
)
