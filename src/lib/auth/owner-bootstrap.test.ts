import { describe, expect, it } from 'vitest'

import { isExpectedOwnerEmail } from './owner-bootstrap'

describe('isExpectedOwnerEmail', () => {
  it('matches the configured owner without trusting casing or padding', () => {
    expect(
      isExpectedOwnerEmail('  Owner@Example.com ', 'owner@example.com'),
    ).toBe(true)
  })

  it('rejects other and unconfigured addresses', () => {
    expect(isExpectedOwnerEmail('other@example.com', 'owner@example.com')).toBe(
      false,
    )
    expect(isExpectedOwnerEmail('owner@example.com', undefined)).toBe(false)
  })
})
