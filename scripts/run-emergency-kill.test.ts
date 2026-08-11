import { describe, expect, it } from 'vitest'

import {
  classifyEmergencyProcessResult,
  validateEmergencyConfirmation,
  validateEmergencyTarget,
} from './run-emergency-kill.mjs'

const campaignId = '11111111-1111-4111-8111-111111111111'
const direct =
  'postgresql://postgres:opaque@db.qrnuyibntcxwffrxmrvn.supabase.co:5432/postgres?sslmode=verify-full'

describe('minimal DB-first emergency runner', () => {
  it('needs only an exact campaign-scoped confirmation, not a Campaign manifest or Vercel', () => {
    expect(
      validateEmergencyConfirmation(
        campaignId,
        `EMERGENCY KILL CAPITAL LAB CAMPAIGN ${campaignId}`,
      ),
    ).toContain(campaignId)
    expect(() =>
      validateEmergencyConfirmation(campaignId, 'EMERGENCY KILL'),
    ).toThrow()
  })

  it('accepts only the exact TLS-verified project boundary', () => {
    expect(validateEmergencyTarget(direct)).toBe('direct')
    for (const invalid of [
      direct.replace('verify-full', 'require'),
      direct.replace(':opaque@', ':@'),
      direct.replace('qrnuyibntcxwffrxmrvn', 'aaaaaaaaaaaaaaaaaaaa'),
      direct.replace(':5432/', ':6543/'),
      direct.replace('/postgres?', '/other?'),
      `${direct}&application_name=override`,
    ]) {
      expect(() => validateEmergencyTarget(invalid)).toThrow()
    }
  })

  it('reports timeout, signal, and spawn ambiguity as unknown without retrying', () => {
    expect(
      classifyEmergencyProcessResult({
        code: null,
        signal: null,
        timedOut: true,
        error: null,
      }),
    ).toEqual({
      outcome: 'unknown',
      exitCode: null,
      signal: null,
      timedOut: true,
    })
    expect(
      classifyEmergencyProcessResult({
        code: 0,
        signal: null,
        timedOut: false,
        error: null,
      }).outcome,
    ).toBe('completed')
  })
})
