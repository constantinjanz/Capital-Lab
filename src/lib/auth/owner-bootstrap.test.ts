import { describe, expect, it } from 'vitest'

import {
  getOwnerConfirmationRedirectUrl,
  isExpectedOwnerEmail,
} from './owner-bootstrap'

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

describe('getOwnerConfirmationRedirectUrl', () => {
  it('returns to the hosted login route after email confirmation', () => {
    expect(
      getOwnerConfirmationRedirectUrl('https://capital-lab.example/app'),
    ).toBe('https://capital-lab.example/login?reason=email-confirmed')
  })
})
