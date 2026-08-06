import { describe, expect, it } from 'vitest'

import {
  decimal,
  decimalValue,
  roundToIncrement,
  roundToScale,
} from './decimal'
import { convertQuoteToBase } from './money'

describe('financial decimal boundary', () => {
  it('rejects JavaScript numbers and non-canonical values', () => {
    expect(() => decimal(1 as never)).toThrow(/canonical decimal strings/)
    expect(() => decimal('1e3')).toThrow(/canonical decimal strings/)
    expect(() => decimal('01.20')).toThrow(/canonical decimal strings/)
    expect(() => decimal('NaN')).toThrow(/canonical decimal strings/)
  })

  it('rounds prices and quantities in explicit directions', () => {
    expect(decimalValue(roundToIncrement('10.001', '0.01', 'up'))).toBe('10.01')
    expect(decimalValue(roundToIncrement('10.009', '0.01', 'down'))).toBe('10')
    expect(decimalValue(roundToScale('2.345', 2, 'nearest'))).toBe('2.34')
  })

  it('converts FX without passing through binary floating point', () => {
    expect(
      convertQuoteToBase({
        quoteCurrency: 'USD',
        baseCurrency: 'EUR',
        quoteAmount: '123.45',
        quoteToBaseRate: '0.923456789',
        fxRateId: 'fx-1',
        baseCurrencyScale: 2,
      }).baseAmount,
    ).toBe('114')
  })
})
