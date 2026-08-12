import { describe, expect, it } from 'vitest'

import { parseSchemaGoldenCaptureOptions } from './capture-backup-schema-golden.mjs'

const confirmation = 'UPDATE REVIEWED CAPITAL LAB SCHEMA GOLDEN'
const valid = [
  '--contract=pre',
  `--confirm=${confirmation}`,
  `--expected-reference-proof-sha256=${'a'.repeat(64)}`,
  '--output=C:/ephemeral/pre.json',
  '--reference-proof=C:/ephemeral/pre-proof.json',
]

describe('schema-golden capture CLI parser', () => {
  it('accepts exactly five unique reviewed arguments in any order', () => {
    expect(parseSchemaGoldenCaptureOptions([...valid].reverse())).toEqual({
      contract: 'pre',
      confirm: confirmation,
      'expected-reference-proof-sha256': 'a'.repeat(64),
      output: 'C:/ephemeral/pre.json',
      'reference-proof': 'C:/ephemeral/pre-proof.json',
    })
  })

  it.each([
    ['missing argument', valid.slice(0, -1)],
    ['duplicate argument', [...valid.slice(0, -1), '--output=C:/other.json']],
    ['extra argument', [...valid, '--output=C:/other.json']],
    [
      'wrong confirmation',
      valid.map((value) =>
        value.startsWith('--confirm=') ? '--confirm=unsafe' : value,
      ),
    ],
    [
      'wrong contract',
      valid.map((value) =>
        value === '--contract=pre' ? '--contract=preview' : value,
      ),
    ],
    [
      'wrong retained hash',
      valid.map((value) =>
        value.startsWith('--expected-reference-proof-sha256=')
          ? '--expected-reference-proof-sha256=abc'
          : value,
      ),
    ],
    ['unknown option', [...valid.slice(0, -1), '--proof=C:/other.json']],
  ])('rejects %s before any database action', (_name, argv) => {
    expect(() => parseSchemaGoldenCaptureOptions(argv)).toThrow(
      /arguments are invalid|Explicit --contract/u,
    )
  })
})
