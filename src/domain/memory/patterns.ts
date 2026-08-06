export type PatternEvidenceSummary = {
  independentObservations: number
  hitRateBps: number
  benchmarkRelativeReturnBps: number
  maximumDrawdownBps: number
  holdoutPassed: boolean
}

export type PatternPromotionPolicy = {
  minimumIndependentObservations: number
  minimumHitRateBps: number
  minimumBenchmarkRelativeReturnBps: number
  maximumDrawdownBps: number
  requireHoldout: boolean
}

export type PatternPromotionDecision = {
  eligible: boolean
  reasons: string[]
  nextStatus: 'shadow' | 'eligible'
}

export function evaluatePatternPromotion(
  evidence: PatternEvidenceSummary,
  policy: PatternPromotionPolicy,
): PatternPromotionDecision {
  const reasons: string[] = []
  if (
    evidence.independentObservations < policy.minimumIndependentObservations
  ) {
    reasons.push('INSUFFICIENT_INDEPENDENT_OBSERVATIONS')
  }
  if (evidence.hitRateBps < policy.minimumHitRateBps) {
    reasons.push('HIT_RATE_BELOW_THRESHOLD')
  }
  if (
    evidence.benchmarkRelativeReturnBps <
    policy.minimumBenchmarkRelativeReturnBps
  ) {
    reasons.push('BENCHMARK_RELATIVE_RETURN_BELOW_THRESHOLD')
  }
  if (evidence.maximumDrawdownBps > policy.maximumDrawdownBps) {
    reasons.push('DRAWDOWN_ABOVE_LIMIT')
  }
  if (policy.requireHoldout && !evidence.holdoutPassed) {
    reasons.push('HOLDOUT_NOT_PASSED')
  }
  return {
    eligible: reasons.length === 0,
    reasons,
    nextStatus: reasons.length === 0 ? 'eligible' : 'shadow',
  }
}
