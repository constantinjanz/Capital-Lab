import { describe, expect, it } from 'vitest'

import { parseJsonWithNumbersAsStrings } from './json-numbers'

describe('parseJsonWithNumbersAsStrings', () => {
  it('preserves integer, decimal, and exponent tokens as exact strings', () => {
    expect(
      parseJsonWithNumbersAsStrings(
        '{"price":123.4500,"size":9007199254740993,"rate":1e-8}',
      ),
    ).toEqual({
      price: '123.4500',
      size: '9007199254740993',
      rate: '1e-8',
    })
  })

  it('does not rewrite digits inside JSON strings', () => {
    expect(parseJsonWithNumbersAsStrings('{"symbol":"ABC123"}')).toEqual({
      symbol: 'ABC123',
    })
  })
})
