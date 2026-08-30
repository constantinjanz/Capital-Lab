import { describe, expect, it } from 'vitest'

import {
  validAuthOwnerClosure,
  validateSyntheticAuthFixture,
} from './local-auth-restore-fixture.mjs'

const owner = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
const record = '33333333-3333-4333-8333-333333333333'
const fixture = {
  schemaVersion: 2,
  users: [
    { id: owner, email: 'owner@local.invalid', password: 'opaque-owner' },
    { id: other, email: 'deny@local.invalid', password: 'opaque-deny' },
  ],
  ownerUserId: owner,
  rlsRecordId: record,
}

describe('synthetic Auth/Owner restore closure', () => {
  it('requires two users, the preserved owner UUID, and an RLS fixture', () => {
    expect(validateSyntheticAuthFixture(fixture)).toEqual(fixture)
    for (const invalid of [
      { ...fixture, users: [] },
      { ...fixture, ownerUserId: other },
      { ...fixture, rlsRecordId: 'not-a-uuid' },
    ]) {
      expect(() => validateSyntheticAuthFixture(invalid)).toThrow()
    }
  })

  it.each([
    ['missing user', { users: 1 }],
    ['missing identity', { identities: 1 }],
    ['missing owner', { owners: 0 }],
    ['orphan owner', { orphanOwners: 1 }],
    ['RLS disabled', { rlsEnabled: false }],
    ['RLS row missing', { rlsRows: 0 }],
  ])('rejects %s', (_label, mutation) => {
    const valid = {
      users: 2,
      identities: 2,
      owners: 1,
      orphanOwners: 0,
      rlsEnabled: true,
      rlsRows: 1,
    }
    expect(validAuthOwnerClosure({ ...valid, ...mutation })).toBe(false)
  })
})
