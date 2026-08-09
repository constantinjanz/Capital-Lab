export type AgentRole = 'luna' | 'terra' | 'sol'
export type AgentExecutionMode = 'shadow' | 'live_paper'

export type ExceptionalSolReason =
  | 'multi_source_conflict'
  | 'portfolio_wide_consequence'
  | 'high_materiality_ambiguity'

export type AgentRoutingPolicy = {
  agentEnabled: boolean
  executionMode: AgentExecutionMode
  livePaperSimulationEnabled: boolean
  solEnabled: boolean
  webSearchEnabled: boolean
  terraDailyCap: number
  solDailyCap: number
  webDailyCap: number
  webMonthlyCap: number
}

export type RoutingDecision =
  { allowed: true; reason: 'selected' } | { allowed: false; reason: string }

function validCount(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`)
  }
}

function capReached(count: number, cap: number, name: string): boolean {
  validCount(count, `${name} count`)
  validCount(cap, `${name} cap`)
  return count >= cap
}

export function routeLuna(input: {
  policy: AgentRoutingPolicy
  regularSessionEligible: boolean
  candidateCount: number
  slotAlreadyUsed: boolean
}): RoutingDecision {
  validCount(input.candidateCount, 'candidate')
  if (!input.policy.agentEnabled)
    return { allowed: false, reason: 'agent_disabled' }
  if (!input.regularSessionEligible)
    return { allowed: false, reason: 'outside_regular_session' }
  if (input.candidateCount === 0)
    return { allowed: false, reason: 'no_candidates' }
  if (input.slotAlreadyUsed)
    return { allowed: false, reason: 'luna_slot_already_used' }
  return { allowed: true, reason: 'selected' }
}

export function routeTerra(input: {
  policy: AgentRoutingPolicy
  qualifyingLunaEvent: boolean
  exceptionalDeterministicTrigger: boolean
  dailyCount: number
}): RoutingDecision {
  if (!input.policy.agentEnabled)
    return { allowed: false, reason: 'agent_disabled' }
  if (!input.qualifyingLunaEvent && !input.exceptionalDeterministicTrigger) {
    return { allowed: false, reason: 'terra_trigger_not_qualified' }
  }
  if (capReached(input.dailyCount, input.policy.terraDailyCap, 'terra')) {
    return { allowed: false, reason: 'terra_daily_cap' }
  }
  return { allowed: true, reason: 'selected' }
}

export function routeSol(input: {
  policy: AgentRoutingPolicy
  terraRequestedEscalation: boolean
  exceptionalReason: ExceptionalSolReason | null
  dailyCount: number
}): RoutingDecision {
  if (!input.policy.agentEnabled || !input.policy.solEnabled) {
    return { allowed: false, reason: 'sol_disabled' }
  }
  if (!input.terraRequestedEscalation) {
    return { allowed: false, reason: 'terra_did_not_request_escalation' }
  }
  if (input.exceptionalReason === null) {
    return { allowed: false, reason: 'sol_exceptional_reason_required' }
  }
  if (capReached(input.dailyCount, input.policy.solDailyCap, 'sol')) {
    return { allowed: false, reason: 'sol_daily_cap' }
  }
  return { allowed: true, reason: 'selected' }
}

export function authorizeControlledWebResearch(input: {
  policy: AgentRoutingPolicy
  requestingRole: AgentRole
  relevantCandidate: boolean
  structuredSourcesChecked: boolean
  structuredSourceGap: boolean
  dailyCount: number
  monthlyCount: number
}): RoutingDecision {
  if (!input.policy.agentEnabled || !input.policy.webSearchEnabled) {
    return { allowed: false, reason: 'web_search_disabled' }
  }
  if (input.requestingRole === 'luna') {
    return { allowed: false, reason: 'luna_web_search_forbidden' }
  }
  if (!input.relevantCandidate) {
    return { allowed: false, reason: 'candidate_not_relevant' }
  }
  if (!input.structuredSourcesChecked) {
    return { allowed: false, reason: 'structured_sources_not_checked' }
  }
  if (!input.structuredSourceGap) {
    return { allowed: false, reason: 'structured_sources_sufficient' }
  }
  if (capReached(input.dailyCount, input.policy.webDailyCap, 'web daily')) {
    return { allowed: false, reason: 'web_daily_cap' }
  }
  if (
    capReached(input.monthlyCount, input.policy.webMonthlyCap, 'web monthly')
  ) {
    return { allowed: false, reason: 'web_monthly_cap' }
  }
  return { allowed: true, reason: 'selected' }
}

export function proposalDisposition(
  policy: AgentRoutingPolicy,
):
  | { kind: 'shadow'; reason: 'shadow_mode' }
  | { kind: 'simulate'; reason: 'explicit_live_paper_simulation' }
  | { kind: 'denied'; reason: 'agent_disabled' | 'live_paper_not_enabled' } {
  if (!policy.agentEnabled) return { kind: 'denied', reason: 'agent_disabled' }
  if (policy.executionMode === 'shadow') {
    return { kind: 'shadow', reason: 'shadow_mode' }
  }
  if (policy.livePaperSimulationEnabled) {
    return { kind: 'simulate', reason: 'explicit_live_paper_simulation' }
  }
  return { kind: 'denied', reason: 'live_paper_not_enabled' }
}
