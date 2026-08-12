import { lstat, realpath } from 'node:fs/promises'
import path from 'node:path'

export const genericDatabasePasswordRule = Object.freeze({
  id: 'CRED-015',
  findingClass: 'generic_database_password_assignment',
  pattern:
    /(?:^|\n)\s*(?:export\s+|\$env:)?(?:DATABASE|DB|POSTGRES|PG|SUPABASE)[A-Z0-9_]*(?:PASSWORD|PASS|PWD)\s*[:=]\s*['"]?(?!\$\{|\$env:|<|\[?redacted|placeholder|change[-_]?me|postgres(?:['"]?\s*$))[^\s'"]{8,}/im,
  historyPattern:
    '(DATABASE|DB|POSTGRES|PG|SUPABASE)[A-Z0-9_]*(PASSWORD|PASS|PWD)[[:space:]]*[:=]',
})

const CODE_FILE = /\.(?:[cm]?[jt]sx?)$/iu
const QUOTED_CODE_DATABASE_PASSWORD =
  /(?:^|\n)\s*(?:(?:const|let|var)\s+|process\.env\.)?['"]?(?:DATABASE|DB|POSTGRES|PG|SUPABASE)[A-Z0-9_]*(?:PASSWORD|PASS|PWD)['"]?\s*[:=]\s*(['"])(?!\$\{|\$env:|<|\[?redacted|placeholder|change[-_]?me|postgres\1\s*$)[^\s'"]{8,}\1/im

export function credentialRuleMatches(rule, filename, content) {
  if (rule.id === genericDatabasePasswordRule.id && CODE_FILE.test(filename)) {
    // In JavaScript/TypeScript, an unquoted identifier on the right-hand side
    // is a variable reference, not a persisted credential. Literal secrets are
    // quoted and remain fail-closed. Shell, env, config, and history candidates
    // continue to use the broader assignment rule.
    return QUOTED_CODE_DATABASE_PASSWORD.test(content)
  }
  return rule.pattern.test(content)
}

export async function assertCredentialCandidatePath(root, candidate) {
  const canonicalRoot = await realpath(root)
  const metadata = await lstat(candidate)
  if (metadata.isSymbolicLink()) {
    throw new Error('Credential candidate is a symlink or junction')
  }
  const canonical = await realpath(candidate)
  const relative = path.relative(canonicalRoot, canonical)
  if (
    relative === '' ||
    relative.startsWith('..') ||
    path.isAbsolute(relative)
  ) {
    throw new Error('Credential candidate escaped the repository')
  }
  return { canonical, metadata }
}
