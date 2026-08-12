import { describe, expect, it } from 'vitest'

import { redactSensitiveText } from './run-redacted-subprocess.mjs'
import {
  buildRedactedSupabaseDiagnostic,
  diagnosticFromStructuredOutput,
  redactedDiagnosticForCi,
  validateRedactedSupabaseDiagnostic,
} from './lib/redacted-supabase-diagnostic.mjs'

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
