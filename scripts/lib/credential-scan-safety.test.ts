import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  assertCredentialCandidatePath,
  credentialRuleMatches,
  genericDatabasePasswordRule,
} from './credential-scan-safety.mjs'

const cleanup: string[] = []

afterEach(async () => {
  while (cleanup.length > 0) {
    await rm(cleanup.pop()!, { force: true, recursive: true })
  }
})

describe('credential scanner path and password safety', () => {
  it('detects generic database passwords without exposing the value', () => {
    const content = [
      'POSTGRES_ADMIN_PASSWORD',
      'fixture-value-that-must-be-redacted',
    ].join('=')
    expect(genericDatabasePasswordRule.pattern.test(content)).toBe(true)
    expect(genericDatabasePasswordRule.findingClass).toBe(
      'generic_database_password_assignment',
    )
    expect(genericDatabasePasswordRule).not.toHaveProperty('matchedValue')
  })

  it('distinguishes a code variable reference from a quoted hardcoded value', () => {
    expect(
      credentialRuleMatches(
        genericDatabasePasswordRule,
        'helper.mjs',
        'PGPASSWORD: password,',
      ),
    ).toBe(false)
    expect(
      credentialRuleMatches(
        genericDatabasePasswordRule,
        'helper.mjs',
        ['PGPASSWORD', "'literal-database-value'"].join(': '),
      ),
    ).toBe(true)
  })

  it('permits placeholders but rejects an external symlink or junction', async () => {
    expect(
      genericDatabasePasswordRule.pattern.test(
        ['POSTGRES_ADMIN_PASSWORD', '<redacted-runtime-value>'].join('='),
      ),
    ).toBe(false)
    const root = await mkdtemp(path.join(tmpdir(), 'credential-root-'))
    const external = await mkdtemp(path.join(tmpdir(), 'credential-external-'))
    cleanup.push(root, external)
    await mkdir(path.join(root, 'config'))
    await writeFile(
      path.join(external, 'secret.env'),
      ['DB_PASSWORD', 'external-value'].join('='),
    )
    const linked = path.join(root, 'config', 'linked-directory')
    await symlink(
      external,
      linked,
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    await expect(assertCredentialCandidatePath(root, linked)).rejects.toThrow(
      /symlink or junction/,
    )
  })
})
