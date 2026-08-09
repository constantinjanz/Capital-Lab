import { describe, expect, it } from 'vitest'

import {
  authorizeControlledWebResearch,
  proposalDisposition,
  routeLuna,
  routeSol,
  routeTerra,
  type AgentRoutingPolicy,
} from './routing'

const policy: AgentRoutingPolicy = {
  agentEnabled: true,
  executionMode: 'shadow',
  livePaperSimulationEnabled: false,
  solEnabled: false,
  webSearchEnabled: false,
  terraDailyCap: 2,
  solDailyCap: 1,
  webDailyCap: 2,
  webMonthlyCap: 25,
}

describe('agent routing policy', () => {
  it('allows Luna once for a regular-session slot with candidates', () => {
    expect(
      routeLuna({
        policy,
        regularSessionEligible: true,
        candidateCount: 1,
        slotAlreadyUsed: false,
      }),
    ).toEqual({ allowed: true, reason: 'selected' })
    expect(
      routeLuna({
        policy,
        regularSessionEligible: true,
        candidateCount: 1,
        slotAlreadyUsed: true,
      }),
    ).toEqual({ allowed: false, reason: 'luna_slot_already_used' })
  })

  it('requires a qualified Terra trigger and enforces the daily cap', () => {
    expect(
      routeTerra({
        policy,
        qualifyingLunaEvent: false,
        exceptionalDeterministicTrigger: false,
        dailyCount: 0,
      }),
    ).toEqual({ allowed: false, reason: 'terra_trigger_not_qualified' })
    expect(
      routeTerra({
        policy,
        qualifyingLunaEvent: true,
        exceptionalDeterministicTrigger: false,
        dailyCount: 2,
      }),
    ).toEqual({ allowed: false, reason: 'terra_daily_cap' })
  })

  it('keeps Sol disabled and later requires an exceptional reason', () => {
    expect(
      routeSol({
        policy,
        terraRequestedEscalation: true,
        exceptionalReason: 'multi_source_conflict',
        dailyCount: 0,
      }),
    ).toEqual({ allowed: false, reason: 'sol_disabled' })

    expect(
      routeSol({
        policy: { ...policy, solEnabled: true },
        terraRequestedEscalation: true,
        exceptionalReason: null,
        dailyCount: 0,
      }),
    ).toEqual({ allowed: false, reason: 'sol_exceptional_reason_required' })
  })

  it('allows web research only after structured sources leave a gap', () => {
    const webPolicy = { ...policy, webSearchEnabled: true }
    expect(
      authorizeControlledWebResearch({
        policy: webPolicy,
        requestingRole: 'luna',
        relevantCandidate: true,
        structuredSourcesChecked: true,
        structuredSourceGap: true,
        dailyCount: 0,
        monthlyCount: 0,
      }),
    ).toEqual({ allowed: false, reason: 'luna_web_search_forbidden' })
    expect(
      authorizeControlledWebResearch({
        policy: webPolicy,
        requestingRole: 'terra',
        relevantCandidate: true,
        structuredSourcesChecked: true,
        structuredSourceGap: true,
        dailyCount: 0,
        monthlyCount: 0,
      }),
    ).toEqual({ allowed: true, reason: 'selected' })
  })

  it('never dispatches a shadow proposal to simulation', () => {
    expect(proposalDisposition(policy)).toEqual({
      kind: 'shadow',
      reason: 'shadow_mode',
    })
    expect(
      proposalDisposition({
        ...policy,
        executionMode: 'live_paper',
        livePaperSimulationEnabled: false,
      }),
    ).toEqual({ kind: 'denied', reason: 'live_paper_not_enabled' })
  })
})
