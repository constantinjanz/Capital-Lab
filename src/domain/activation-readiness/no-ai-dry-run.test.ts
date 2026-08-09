import { describe, expect, it } from 'vitest'

import {
  assertActivationTransition,
  evaluateNoAiDryRun,
  planNoAiInfrastructureDryRun,
  shouldAutoStopNoAiDryRun,
  type VersionedMarketSession,
} from './no-ai-dry-run'

function session(
  sessionDate: string,
  opensAt: string | null,
  closesAt: string | null,
  sessionType: VersionedMarketSession['sessionType'] = 'regular',
): VersionedMarketSession {
  return {
    sessionDate,
    sessionType,
    opensAt,
    closesAt,
    availableAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('no-AI infrastructure dry-run planning', () => {
  it('uses the current regular session only when activated before its open', () => {
    const plan = planNoAiInfrastructureDryRun({
      activatedAt: '2026-08-10T12:00:00.000Z',
      decisionAt: '2026-08-10T12:00:00.000Z',
      activationSessionDate: '2026-08-10',
      sessions: [
        session(
          '2026-08-10',
          '2026-08-10T13:30:00.000Z',
          '2026-08-10T20:00:00.000Z',
        ),
        session(
          '2026-08-11',
          '2026-08-11T13:30:00.000Z',
          '2026-08-11T20:00:00.000Z',
        ),
      ],
    })

    expect(plan.sessionDates).toEqual(['2026-08-10', '2026-08-11'])
    expect(plan.expectedSlots).toHaveLength(52)
    expect(plan.expectedEvents).toHaveLength(104)
    expect(plan.plannedEndAt).toBe('2026-08-11T20:10:00.000Z')
  })

  it('moves an in-session activation to the next two complete sessions', () => {
    const plan = planNoAiInfrastructureDryRun({
      activatedAt: '2026-08-10T14:00:00.000Z',
      decisionAt: '2026-08-10T14:00:00.000Z',
      activationSessionDate: '2026-08-10',
      sessions: [
        session(
          '2026-08-10',
          '2026-08-10T13:30:00.000Z',
          '2026-08-10T20:00:00.000Z',
        ),
        session(
          '2026-08-11',
          '2026-08-11T13:30:00.000Z',
          '2026-08-11T20:00:00.000Z',
        ),
        session(
          '2026-08-12',
          '2026-08-12T13:30:00.000Z',
          '2026-08-12T20:00:00.000Z',
        ),
      ],
    })

    expect(plan.sessionDates).toEqual(['2026-08-11', '2026-08-12'])
  })

  it('handles a weekend, a recorded holiday, DST timestamps, and excludes early close', () => {
    const plan = planNoAiInfrastructureDryRun({
      activatedAt: '2026-11-25T22:00:00.000Z',
      decisionAt: '2026-11-25T22:00:00.000Z',
      activationSessionDate: '2026-11-25',
      sessions: [
        session(
          '2026-11-25',
          '2026-11-25T14:30:00.000Z',
          '2026-11-25T21:00:00.000Z',
        ),
        session('2026-11-26', null, null, 'closed'),
        session(
          '2026-11-27',
          '2026-11-27T14:30:00.000Z',
          '2026-11-27T18:00:00.000Z',
          'early_close',
        ),
        session(
          '2026-11-30',
          '2026-11-30T14:30:00.000Z',
          '2026-11-30T21:00:00.000Z',
        ),
        session(
          '2026-12-01',
          '2026-12-01T14:30:00.000Z',
          '2026-12-01T21:00:00.000Z',
        ),
      ],
    })

    expect(plan.sessionDates).toEqual(['2026-11-30', '2026-12-01'])
    expect(plan.plannedStartAt).toBe('2026-11-30T14:30:00.000Z')
  })

  it('fails closed when a weekday calendar row is missing', () => {
    expect(() =>
      planNoAiInfrastructureDryRun({
        activatedAt: '2026-08-10T22:00:00.000Z',
        decisionAt: '2026-08-10T22:00:00.000Z',
        activationSessionDate: '2026-08-10',
        sessions: [
          session(
            '2026-08-11',
            '2026-08-11T13:30:00.000Z',
            '2026-08-11T20:00:00.000Z',
          ),
          session(
            '2026-08-13',
            '2026-08-13T13:30:00.000Z',
            '2026-08-13T20:00:00.000Z',
          ),
        ],
      }),
    ).toThrow('calendar coverage is incomplete')
  })
})

describe('no-AI dry-run state and evidence gates', () => {
  it('does not allow a state to be skipped', () => {
    expect(() => assertActivationTransition('prepared', 'armed')).toThrow(
      'forbidden',
    )
    expect(() =>
      assertActivationTransition('running', 'auto_stopped'),
    ).not.toThrow()
  })

  it('treats a missing slot as failure rather than success by inactivity', () => {
    const plan = planNoAiInfrastructureDryRun({
      activatedAt: '2026-08-10T12:00:00.000Z',
      decisionAt: '2026-08-10T12:00:00.000Z',
      activationSessionDate: '2026-08-10',
      sessions: [
        session(
          '2026-08-10',
          '2026-08-10T13:30:00.000Z',
          '2026-08-10T20:00:00.000Z',
        ),
        session(
          '2026-08-11',
          '2026-08-11T13:30:00.000Z',
          '2026-08-11T20:00:00.000Z',
        ),
      ],
    })
    const result = evaluateNoAiDryRun({ plan, actualSlots: [] })

    expect(result.passed).toBe(false)
    expect(result.failures).toHaveLength(52)
    expect(result.failures[0]).toMatch(/^missing_slot:/)
  })

  it('auto-stops at the registered end even when the owner forgets', () => {
    expect(
      shouldAutoStopNoAiDryRun({
        plannedEndAt: '2026-08-11T20:10:00.000Z',
        observedAt: '2026-08-11T20:09:59.999Z',
      }),
    ).toBe(false)
    expect(
      shouldAutoStopNoAiDryRun({
        plannedEndAt: '2026-08-11T20:10:00.000Z',
        observedAt: '2026-08-11T20:10:00.000Z',
      }),
    ).toBe(true)
  })
})
