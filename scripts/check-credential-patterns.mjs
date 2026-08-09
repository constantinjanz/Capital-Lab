import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const ignoredDirectories = new Set([
  '.git',
  '.next',
  '.vercel',
  'node_modules',
  'node_modules.partial',
  'capital-lab-scaffold',
  'coverage',
  'playwright-report',
  'test-results',
])

const rules = [
  {
    id: 'CRED-001',
    findingClass: 'asymmetric_private_key',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
  {
    id: 'CRED-002',
    findingClass: 'openai_api_secret',
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/,
  },
  {
    id: 'CRED-003',
    findingClass: 'supabase_server_secret',
    pattern: /\bsb_secret_[A-Za-z0-9_-]{16,}\b/,
  },
  {
    id: 'CRED-004',
    findingClass: 'supabase_publishable_credential',
    pattern: /\bsb_publishable_[A-Za-z0-9_-]{16,}\b/,
  },
  {
    id: 'CRED-005',
    findingClass: 'jwt_bearer_credential',
    pattern:
      /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/,
  },
  {
    id: 'CRED-006',
    findingClass: 'github_access_token',
    pattern: /\bgh(?:p|o|u|s|r)_[A-Za-z0-9]{20,}\b/,
  },
  {
    id: 'CRED-007',
    findingClass: 'aws_access_key_id',
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  },
]

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await filesUnder(fullPath)))
    else if (
      /\.(?:ts|tsx|js|mjs|cjs|json|md|sql|toml|ya?ml|env|txt)$/i.test(
        entry.name,
      )
    ) {
      files.push(fullPath)
    }
  }

  return files
}

const self = path.join(root, 'scripts', 'check-credential-patterns.mjs')
const findings = []

for (const filename of await filesUnder(root)) {
  if (filename === self) continue
  const content = await readFile(filename, 'utf8')
  for (const rule of rules) {
    if (rule.pattern.test(content)) {
      findings.push({
        path: path.relative(root, filename).replaceAll('\\', '/'),
        ruleId: rule.id,
        findingClass: rule.findingClass,
      })
    }
  }
}

findings.sort((left, right) =>
  `${left.path}:${left.ruleId}`.localeCompare(`${right.path}:${right.ruleId}`),
)

if (findings.length > 0) {
  for (const finding of findings) {
    console.error(`${finding.path}\t${finding.ruleId}\t${finding.findingClass}`)
  }
  process.exit(1)
}

console.log('Credential pattern scan passed with zero redacted findings.')
