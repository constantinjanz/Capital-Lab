import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  canonicalSupabaseStartArguments,
  parseRedactedSupabaseStartArguments,
  redactSensitiveText,
} from './run-redacted-subprocess.mjs'
import {
  buildRedactedSupabaseDiagnostic,
  diagnosticFromStructuredOutput,
  redactedDiagnosticForCi,
  validateRedactedSupabaseDiagnostic,
} from './lib/redacted-supabase-diagnostic.mjs'

const runner = fileURLToPath(
  new URL('./run-redacted-subprocess.mjs', import.meta.url),
)

function startArgv(role: string, args: unknown[]) {
  return [
    `--id=${role}-start`,
    `--role=${role}`,
    '--',
    'supabase',
    ...args,
  ] as string[]
}

describe('local subprocess credential redaction', () => {
  it.each([
    'Authorization: Bearer opaque-local-value',
    [
      'Bearer eyJhbGciOiJIUzI1NiJ9',
      'eyJzdWIiOiJsb2NhbCJ9',
      'opaque_signature',
    ].join('.'),
    [
      'postgresql',
      '://postgres:',
      'local-password',
      '@127.0.0.1:54322/postgres',
    ].join(''),
    ['sb', '_secret_local_', 'abcdefghijklmnopqrstuvwxyz'].join(''),
    ['sb', '_publishable_local_', 'abcdefghijklmnopqrstuvwxyz'].join(''),
    ['ver', 'cel_', 'abcdefghijklmnopqrstuvwxyz'].join(''),
    'password=local-password',
    'cookie=session-local-value',
  ])('removes %s without returning the matched value', (input) => {
    const output = redactSensitiveText(input)
    expect(output).not.toContain(input)
    expect(output).toContain('[redacted')
  })

  it('detects URL-encoded credential output', () => {
    const input = encodeURIComponent(
      [
        'postgresql',
        '://postgres:',
        'local-password',
        '@127.0.0.1:54322/postgres',
      ].join(''),
    )
    expect(redactSensitiveText(input)).toBe(
      '[redacted-url-encoded-sensitive-output]',
    )
  })
})

describe('exact allowlisted Supabase start arguments', () => {
  it.each(['reference', 'restore', 'source'] as const)(
    'preserves the exact two-argument %s start',
    (role) => {
      expect(
        parseRedactedSupabaseStartArguments(
          startArgv(role, ['start', '--workdir=C:/owned-stack']),
        ),
      ).toEqual({
        args: ['start', '--workdir=C:/owned-stack'],
        command: 'supabase',
        hasStorageApiExclude: false,
        id: `${role}-start`,
        role,
      })
    },
  )

  it('accepts and then discards only the exact Reference exclude input', () => {
    expect(
      parseRedactedSupabaseStartArguments(
        startArgv('reference', [
          'start',
          '--workdir=C:/owned-reference',
          '--exclude=storage-api',
        ]),
      ),
    ).toEqual({
      args: ['start', '--workdir=C:/owned-reference'],
      command: 'supabase',
      hasStorageApiExclude: true,
      id: 'reference-start',
      role: 'reference',
    })
    expect(
      canonicalSupabaseStartArguments('C:/canonical-reference', true),
    ).toEqual([
      'start',
      '--workdir=C:/canonical-reference',
      '--exclude=storage-api',
    ])
    expect(
      canonicalSupabaseStartArguments('C:/canonical-source', false),
    ).toEqual(['start', '--workdir=C:/canonical-source'])
  })

  it.each(['restore', 'source'] as const)(
    'rejects the Reference-only exclude for %s',
    (role) => {
      expect(() =>
        parseRedactedSupabaseStartArguments(
          startArgv(role, [
            'start',
            '--workdir=C:/owned-stack',
            '--exclude=storage-api',
          ]),
        ),
      ).toThrow(/outside the exact allowlist/u)
    },
  )

  it.each([
    [
      'split exclude',
      ['start', '--workdir=C:/owned-reference', '--exclude', 'storage-api'],
    ],
    [
      'different service',
      ['start', '--workdir=C:/owned-reference', '--exclude=imgproxy'],
    ],
    [
      'combined services',
      [
        'start',
        '--workdir=C:/owned-reference',
        '--exclude=storage-api,imgproxy',
      ],
    ],
    [
      'comma-duplicated service',
      [
        'start',
        '--workdir=C:/owned-reference',
        '--exclude=storage-api,storage-api',
      ],
    ],
    [
      'duplicated exclude',
      [
        'start',
        '--workdir=C:/owned-reference',
        '--exclude=storage-api',
        '--exclude=storage-api',
      ],
    ],
    [
      'reordered arguments',
      ['start', '--exclude=storage-api', '--workdir=C:/owned-reference'],
    ],
    [
      'additional argument',
      [
        'start',
        '--workdir=C:/owned-reference',
        '--exclude=storage-api',
        '--debug',
      ],
    ],
    ['empty exclude', ['start', '--workdir=C:/owned-reference', '--exclude=']],
    [
      'malformed exclude',
      ['start', '--workdir=C:/owned-reference', '--exclude'],
    ],
    ['non-string exclude', ['start', '--workdir=C:/owned-reference', null]],
    ['empty workdir', ['start', '--workdir=']],
    ['malformed workdir', ['start', '--workdir']],
    ['linked project', ['link', '--project-ref=hosted-project']],
    ['database push', ['db', 'push']],
    [
      'hosted project argument',
      ['start', '--workdir=C:/owned-reference', '--project-ref=hosted-project'],
    ],
  ] as const)('rejects %s', (_label, args) => {
    expect(() =>
      parseRedactedSupabaseStartArguments(startArgv('reference', [...args])),
    ).toThrow()
  })

  it('validates the third input before canonicalization and reconstructs a literal', () => {
    const source = readFileSync(runner, 'utf8')
    const parser = source.indexOf(
      'export function parseRedactedSupabaseStartArguments',
    )
    const thirdInputValidation = source.indexOf(
      "args[2] !== '--exclude=storage-api'",
      parser,
    )
    const canonicalizer = source.indexOf(
      'async function canonicalizeArguments',
      thirdInputValidation,
    )
    const builder = source.slice(
      source.indexOf('export function canonicalSupabaseStartArguments'),
      canonicalizer,
    )
    const canonicalizerBody = source.slice(
      canonicalizer,
      source.indexOf('export async function runRedacted', canonicalizer),
    )
    expect(parser).toBeGreaterThanOrEqual(0)
    expect(thirdInputValidation).toBeGreaterThan(parser)
    expect(canonicalizer).toBeGreaterThan(thirdInputValidation)
    expect(builder).toContain("['--exclude=storage-api']")
    expect(builder).not.toContain('args[2]')
    expect(canonicalizerBody).not.toContain('args[2]')
  })

  it('never emits rejected raw arguments, paths, IDs, ports, or secrets', () => {
    const rawId = 'reference-start-59999'
    const rawPath = 'C:/private/reference-59999-token-fake-path'
    const rawExclude = '--exclude=storage-api,token=fake-exclude-secret'
    const outcome = spawnSync(
      process.execPath,
      [
        runner,
        `--id=${rawId}`,
        '--role=reference',
        '--',
        'supabase',
        'start',
        `--workdir=${rawPath}`,
        rawExclude,
      ],
      { encoding: 'utf8' },
    )
    expect(outcome.status).toBe(2)
    expect(outcome.stderr).toBe('')
    expect(JSON.parse(outcome.stdout)).toMatchObject({
      failure_category: 'unknown_redacted_failure',
      exit_code: 2,
    })
    for (const forbidden of [rawId, rawPath, rawExclude, '59999', 'fake-']) {
      expect(`${outcome.stdout}${outcome.stderr}`).not.toContain(forbidden)
    }
  })
})

describe('allowlisted Supabase start diagnostics', () => {
  const fakeSecrets = [
    'Authorization: Bearer fake-bearer-value',
    [
      'postgresql',
      '://postgres:',
      'fake-password',
      '@127.0.0.1:54322/postgres',
    ].join(''),
    'token=fake-ci-token',
  ].join(' ')

  it.each([
    [
      'migration_failed',
      'Applying migration 20260812140953_fourth_activation_readiness_review_closure.sql failed ERROR SQLSTATE 42P01 supabase_db_capital-lab',
      'db',
      '20260812140953_fourth_activation_readiness_review_closure.sql',
      '42P01',
    ],
    [
      'container_unhealthy',
      'container supabase_auth_capital-lab is unhealthy',
      'auth',
      null,
      null,
    ],
    [
      'registry_pull_failed',
      'failed to pull public.ecr.aws/supabase/postgres:17: manifest unknown',
      null,
      null,
      null,
    ],
    [
      'port_conflict',
      'service db failed: listen tcp 127.0.0.1:54322: bind: address already in use',
      'db',
      null,
      null,
    ],
    [
      'docker_unavailable',
      'Cannot connect to the Docker daemon',
      null,
      null,
      null,
    ],
    [
      'service_start_failed',
      'service storage failed to start',
      'storage',
      null,
      null,
    ],
    [
      'unknown_redacted_failure',
      'opaque local startup failure',
      null,
      null,
      null,
    ],
  ])(
    'classifies %s without exposing private child output',
    (category, raw, service, migration, sqlstate) => {
      const diagnostic = buildRedactedSupabaseDiagnostic(
        `${raw} ${fakeSecrets}`,
        { code: 1, signal: null, timedOut: false, spawnError: false },
      )
      const serialized = JSON.stringify(diagnostic)
      expect(diagnostic).toEqual({
        failure_category: category,
        container_or_service: service,
        migration_basename: migration,
        sqlstate,
        timeout: false,
        signal: null,
        exit_code: 1,
      })
      for (const value of [
        'fake-bearer-value',
        'fake-password',
        'fake-ci-token',
      ]) {
        expect(serialized).not.toContain(value)
      }
    },
  )

  it('accepts only the exact diagnostic field and value allowlist', () => {
    const valid = buildRedactedSupabaseDiagnostic('', {
      code: 0,
      signal: null,
      timedOut: false,
      spawnError: false,
    })
    expect(validateRedactedSupabaseDiagnostic(valid)).toEqual(valid)
    expect(
      diagnosticFromStructuredOutput(
        `${JSON.stringify({ ...valid, raw: fakeSecrets })}\n${JSON.stringify(valid)}\n`,
      ),
    ).toEqual(valid)
    expect(() =>
      validateRedactedSupabaseDiagnostic({ ...valid, raw: fakeSecrets }),
    ).toThrow(/outside the allowlist/u)
  })

  it('records timeout and signal without retaining the error text', () => {
    const diagnostic = buildRedactedSupabaseDiagnostic(fakeSecrets, {
      code: null,
      signal: 'SIGTERM',
      timedOut: true,
      spawnError: false,
    })
    expect(diagnostic).toMatchObject({
      failure_category: 'service_start_failed',
      timeout: true,
      signal: 'SIGTERM',
      exit_code: null,
    })
    expect(JSON.stringify(diagnostic)).not.toContain('fake-')
  })

  it('copies only an exact diagnostic into CI evidence and uses a safe fallback', () => {
    const diagnostic = buildRedactedSupabaseDiagnostic(
      `service auth failed to start ${fakeSecrets}`,
      { code: 1, signal: null, timedOut: false, spawnError: false },
    )
    const copied = redactedDiagnosticForCi(
      'supabase-start',
      `${fakeSecrets}\n${JSON.stringify(diagnostic)}\n`,
      { exitCode: 1, signal: null, timedOut: false },
    )
    const fallback = redactedDiagnosticForCi('supabase-start', fakeSecrets, {
      exitCode: 1,
      signal: null,
      timedOut: false,
    })
    expect(copied).toEqual(diagnostic)
    expect(fallback?.failure_category).toBe('unknown_redacted_failure')
    expect(JSON.stringify({ redactedDiagnostic: copied })).not.toMatch(
      /fake-bearer|fake-password|fake-ci-token/u,
    )
    expect(JSON.stringify({ redactedDiagnostic: fallback })).not.toMatch(
      /fake-bearer|fake-password|fake-ci-token/u,
    )
  })
})
