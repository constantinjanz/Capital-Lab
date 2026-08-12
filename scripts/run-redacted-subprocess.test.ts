import { describe, expect, it } from 'vitest'

import { redactSensitiveText } from './run-redacted-subprocess.mjs'

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
