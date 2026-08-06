import { describe, expect, it } from 'vitest'

import { fifteenMinuteSlotKey, mockUsRegularSession } from './market-session'

describe('market-session scheduling', () => {
  it('uses New York regular hours across UTC offsets', () => {
    expect(
      mockUsRegularSession(new Date('2026-08-06T14:00:00.000Z')).eligible,
    ).toBe(true)
    expect(
      mockUsRegularSession(new Date('2026-08-06T21:00:00.000Z')).eligible,
    ).toBe(false)
  })

  it('builds stable 15-minute idempotency slots', () => {
    expect(
      fifteenMinuteSlotKey(
        'market-cycle',
        'exp-1',
        new Date('2026-08-06T14:14:59.999Z'),
      ),
    ).toBe('market-cycle:exp-1:2026-08-06T14:00:00.000Z')
  })
})
