import { describe, expect, it } from 'vitest'

import { canonicalRepositoryTextBytes } from './canonical-repository-bytes.mjs'

describe('canonical repository text bytes', () => {
  it('makes LF, CRLF, and CR checkouts produce the same reviewed bytes', () => {
    const expected = Buffer.from('select 1;\nselect 2;\n')
    expect(canonicalRepositoryTextBytes(expected)).toEqual(expected)
    expect(
      canonicalRepositoryTextBytes(Buffer.from('select 1;\r\nselect 2;\r\n')),
    ).toEqual(expected)
    expect(
      canonicalRepositoryTextBytes(Buffer.from('select 1;\rselect 2;\r')),
    ).toEqual(expected)
  })

  it('rejects binary and invalid UTF-8 input', () => {
    expect(() => canonicalRepositoryTextBytes(Buffer.from([0]))).toThrow(
      'must be textual',
    )
    expect(() => canonicalRepositoryTextBytes(Buffer.from([0xff]))).toThrow()
  })
})
