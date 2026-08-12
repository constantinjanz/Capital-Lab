import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const EXPECTED = {
  contractVersion: 'capital-lab-schema-golden-bootstrap-v1',
  postgresImage: 'public.ecr.aws/supabase/postgres:17.6.1.158',
  postgresImageRegistry: 'public.ecr.aws/supabase',
  supabaseCliVersion: '2.113.0',
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export async function loadSchemaGoldenBootstrapContract(workspace) {
  const filename = path.join(
    workspace,
    'supabase',
    'backup',
    'schema-golden-bootstrap.v1.json',
  )
  const bytes = await readFile(filename)
  let contract
  try {
    contract = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new Error('Schema-golden bootstrap contract is invalid JSON')
  }
  if (
    bytes.toString('utf8') !== `${canonical(contract)}\n` ||
    canonical(contract) !== canonical(EXPECTED)
  ) {
    throw new Error('Schema-golden bootstrap contract is unreviewed or stale')
  }
  return {
    contract,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}
