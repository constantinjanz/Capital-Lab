import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import {
  resolvedArguments,
  resolveNativeExecutable,
} from './lib/safe-process.mjs'
import {
  assertCredentialCandidatePath,
  credentialRuleMatches,
  genericDatabasePasswordRule,
} from './lib/credential-scan-safety.mjs'

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
    historyPattern: '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----',
  },
  {
    id: 'CRED-002',
    findingClass: 'openai_api_secret',
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/,
    historyPattern: 'sk-(proj-)?[A-Za-z0-9_-]{20,}',
  },
  {
    id: 'CRED-003',
    findingClass: 'supabase_server_secret',
    pattern: /\bsb_secret_[A-Za-z0-9_-]{16,}\b/,
    historyPattern: 'sb_secret_[A-Za-z0-9_-]{16,}',
  },
  {
    id: 'CRED-004',
    findingClass: 'supabase_publishable_credential',
    pattern: /\bsb_publishable_[A-Za-z0-9_-]{16,}\b/,
    historyPattern: 'sb_publishable_[A-Za-z0-9_-]{16,}',
  },
  {
    id: 'CRED-005',
    findingClass: 'jwt_bearer_credential',
    pattern:
      /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/,
    historyPattern:
      'eyJ[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{10,}',
  },
  {
    id: 'CRED-006',
    findingClass: 'github_access_token',
    pattern: /\bgh(?:p|o|u|s|r)_[A-Za-z0-9]{20,}\b/,
    historyPattern: 'gh(p|o|u|s|r)_[A-Za-z0-9]{20,}',
  },
  {
    id: 'CRED-007',
    findingClass: 'aws_access_key_id',
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
    historyPattern: '(AKIA|ASIA)[A-Z0-9]{16}',
  },
  {
    id: 'CRED-008',
    findingClass: 'database_url_with_embedded_password',
    pattern:
      /\bpostgres(?:ql)?:\/\/(?!postgres:postgres@(?:127\.0\.0\.1|localhost|\[::1\]))[^:\s/]+:[^@\s/]{8,}@[a-z0-9.\[\]:-]+(?::\d+)?\/[a-z0-9_-]+/i,
    historyPattern:
      'postgres(ql)?://[^:[:space:]/]+:[^@[:space:]/]{8,}@[A-Za-z0-9.-]+(:[0-9]+)?/[A-Za-z0-9_-]+',
  },
  {
    id: 'CRED-009',
    findingClass: 'npm_registry_auth_token',
    pattern: /(?:^|\n)\s*(?:\/\/[^\s:]+\/)?_authToken\s*=\s*[^${\s][^\s]{15,}/,
    historyPattern:
      '_authToken[[:space:]]*=[[:space:]]*[^$[:space:]][^[:space:]]{15,}',
  },
  {
    id: 'CRED-010',
    findingClass: 'vercel_access_token',
    pattern: /\b(?:vercel|vc)_[A-Za-z0-9_-]{20,}\b/i,
    historyPattern: '(vercel|vc)_[A-Za-z0-9_-]{20,}',
  },
  {
    id: 'CRED-011',
    findingClass: 'supabase_personal_access_token',
    pattern: /\bsbp_[A-Za-z0-9_-]{20,}\b/,
    historyPattern: 'sbp_[A-Za-z0-9_-]{20,}',
  },
  {
    id: 'CRED-012',
    findingClass: 'github_fine_grained_token',
    pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
    historyPattern: 'github_pat_[A-Za-z0-9_]{20,}',
  },
  {
    id: 'CRED-013',
    findingClass: 'literal_authorization_bearer',
    pattern: /\bAuthorization\s*[:=]\s*['"]?Bearer\s+[A-Za-z0-9._~-]{20,}/i,
    historyPattern:
      'Authorization[[:space:]]*[:=][[:space:]]*Bearer[[:space:]]+[A-Za-z0-9._~-]{20,}',
  },
  genericDatabasePasswordRule,
]

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    // Ignore generated dependency/output names regardless of whether Windows
    // exposes them as directories or junctions. Non-ignored links continue to
    // the bounded stat/read path and therefore cannot silently escape scope.
    if (ignoredDirectories.has(entry.name)) continue
    const fullPath = path.join(directory, entry.name)
    const { metadata } = await assertCredentialCandidatePath(root, fullPath)
    if (metadata.isDirectory()) files.push(...(await filesUnder(fullPath)))
    else if (
      entry.name.startsWith('.env') ||
      entry.name === '.npmrc' ||
      entry.name.endsWith('.pem') ||
      entry.name.endsWith('.key') ||
      !entry.name.includes('.') ||
      /\.(?:ts|tsx|js|mjs|cjs|json|md|sql|toml|ya?ml|env|txt|sh|bash|zsh|ps1|psm1|bat|cmd|ini|conf|config|properties)$/i.test(
        entry.name,
      )
    ) {
      if (metadata.size > 2 * 1024 * 1024) {
        throw new Error('Credential candidate exceeds the bounded scanner size')
      }
      files.push(fullPath)
    }
  }

  return files
}

const self = path.join(root, 'scripts', 'check-credential-patterns.mjs')
const findings = []

function scanContent(rule, filename, content) {
  if (
    rule.id === 'CRED-008' &&
    /(?:^|\/)critical-backup-contract\.test\.ts$/u.test(
      filename.replaceAll('\\', '/'),
    )
  ) {
    return content.replace(
      /\bpostgres(?:ql)?:\/\/[^\s@/]+@(?:127\.0\.0\.1|localhost|\[::1\]|db\.example\.com)(?::\d+)?\/[a-z0-9_-]+(?:\?sslmode=verify-full)?(?:#[a-z0-9_-]+)?/giu,
      '[synthetic-reserved-postgres-fixture]',
    )
  }
  return content
}

const git = resolveNativeExecutable('git')
const head = spawnSync(
  git.command,
  resolvedArguments(git, ['rev-parse', 'HEAD']),
  { cwd: root, encoding: 'utf8', shell: false, windowsHide: true },
)
const headSha = head.stdout.trim()
if (head.status !== 0 || !/^[0-9a-f]{40}$/u.test(headSha)) {
  throw new Error('Credential scan could not verify the current Git HEAD')
}
const assertedHeadSha = process.env.CAPITAL_LAB_CI_COMMIT_SHA
if (
  assertedHeadSha !== undefined &&
  (!/^[0-9a-f]{40}$/u.test(assertedHeadSha) || assertedHeadSha !== headSha)
) {
  throw new Error('Credential scan commit assertion does not match Git HEAD')
}
const verifiedHeadSha = assertedHeadSha ?? headSha
const history = spawnSync(
  git.command,
  resolvedArguments(git, ['rev-list', '--max-count=100', verifiedHeadSha]),
  { cwd: root, encoding: 'utf8', shell: false, windowsHide: true },
)
if (history.status !== 0) {
  throw new Error(
    'Bounded Git-history credential scan could not enumerate commits',
  )
}
const commits = history.stdout.trim().split(/\r?\n/).filter(Boolean)
const totalHistory = spawnSync(
  git.command,
  resolvedArguments(git, ['rev-list', '--count', verifiedHeadSha]),
  { cwd: root, encoding: 'utf8', shell: false, windowsHide: true },
)
const totalCommitCount = Number.parseInt(totalHistory.stdout.trim(), 10)
const requiredCommitCount = Math.min(100, totalCommitCount)
if (
  totalHistory.status !== 0 ||
  !Number.isSafeInteger(totalCommitCount) ||
  totalCommitCount < 1 ||
  commits.length < requiredCommitCount
) {
  throw new Error('Git-history credential coverage is incomplete')
}
for (const rule of rules.filter((candidate) => candidate.historyPattern)) {
  const result = spawnSync(
    git.command,
    resolvedArguments(git, [
      'grep',
      '-I',
      '-l',
      '-E',
      '-e',
      rule.historyPattern,
      ...commits,
      '--',
      '.',
    ]),
    {
      cwd: root,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    },
  )
  if (result.status === 0) {
    for (const matched of result.stdout.trim().split(/\r?\n/).filter(Boolean)) {
      const separator = matched.indexOf(':')
      const commit = matched.slice(0, separator)
      const filename = matched.slice(separator + 1)
      const blob = spawnSync(
        git.command,
        resolvedArguments(git, ['show', `${commit}:${filename}`]),
        {
          cwd: root,
          encoding: 'utf8',
          shell: false,
          windowsHide: true,
          maxBuffer: 4 * 1024 * 1024,
        },
      )
      if (blob.status !== 0) {
        throw new Error(
          'Bounded Git-history credential scan could not inspect a candidate',
        )
      }
      if (
        !credentialRuleMatches(
          rule,
          filename,
          scanContent(rule, filename, blob.stdout),
        )
      )
        continue
      findings.push({
        path: `git-history/${commit.slice(0, 12)}/${filename}`,
        ruleId: rule.id,
        findingClass: rule.findingClass,
      })
    }
  } else if (result.status !== 1) {
    throw new Error('Bounded Git-history credential scan failed closed')
  }
}

for (const filename of await filesUnder(root)) {
  if (filename === self) continue
  const bytes = await readFile(filename)
  if (bytes.includes(0)) {
    findings.push({
      path: path.relative(root, filename).replaceAll('\\', '/'),
      ruleId: 'CRED-014',
      findingClass: 'unscannable_binary_candidate',
    })
    continue
  }
  const content = bytes.toString('utf8')
  for (const rule of rules) {
    if (
      credentialRuleMatches(
        rule,
        filename,
        scanContent(rule, filename, content),
      )
    ) {
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

console.log(
  `Credential scan passed: working tree plus ${commits.length} bounded Git-history commits, zero redacted findings.`,
)
