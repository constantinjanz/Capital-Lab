import { decimal, type DecimalValue } from '@/domain/financial/decimal'

export type PatternEvidenceSummary = {
  independentObservations: number
  hitRate: DecimalValue
  meanBenchmarkRelativeReturn: DecimalValue
  worstMaximumAdverseExcursion: DecimalValue
  holdoutPassed: boolean
}

export type PatternPromotionPolicy = {
  version: string
  minimumIndependentObservations: number
  minimumHitRate: DecimalValue
  minimumMeanBenchmarkRelativeReturn: DecimalValue
  minimumAllowedMaximumAdverseExcursion: DecimalValue
  requireHoldout: boolean
}

export type PatternPromotionDecision = {
  eligible: boolean
  policyVersion: string
  reasons: string[]
  nextStatus: 'shadow' | 'eligible'
}

export const HOSTED_PATTERN_PROMOTION_POLICY_V1: PatternPromotionPolicy = {
  version: 'hosted-pattern-promotion-v1',
  minimumIndependentObservations: 30,
  minimumHitRate: '0.55',
  minimumMeanBenchmarkRelativeReturn: '0.01',
  minimumAllowedMaximumAdverseExcursion: '-0.12',
  requireHoldout: true,
}

function observationCount(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`)
  }
  return value
}

function probability(value: DecimalValue, name: string) {
  const parsed = decimal(value)
  if (parsed.lt(0) || parsed.gt(1)) {
    throw new RangeError(`${name} must be between zero and one`)
  }
  return parsed
}

function adverseExcursion(value: DecimalValue, name: string) {
  const parsed = decimal(value)
  if (parsed.gt(0)) {
    throw new RangeError(`${name} must not be positive`)
  }
  return parsed
}

export function evaluatePatternPromotion(
  evidence: PatternEvidenceSummary,
  policy: PatternPromotionPolicy,
): PatternPromotionDecision {
  if (!policy.version.trim()) {
    throw new RangeError('Pattern promotion policy version is required')
  }
  const independentObservations = observationCount(
    evidence.independentObservations,
    'independentObservations',
  )
  const minimumIndependentObservations = observationCount(
    policy.minimumIndependentObservations,
    'minimumIndependentObservations',
  )
  const hitRate = probability(evidence.hitRate, 'hitRate')
  const minimumHitRate = probability(policy.minimumHitRate, 'minimumHitRate')
  const meanBenchmarkRelativeReturn = decimal(
    evidence.meanBenchmarkRelativeReturn,
  )
  const minimumMeanBenchmarkRelativeReturn = decimal(
    policy.minimumMeanBenchmarkRelativeReturn,
  )
  const worstMaximumAdverseExcursion = adverseExcursion(
    evidence.worstMaximumAdverseExcursion,
    'worstMaximumAdverseExcursion',
  )
  const minimumAllowedMaximumAdverseExcursion = adverseExcursion(
    policy.minimumAllowedMaximumAdverseExcursion,
    'minimumAllowedMaximumAdverseExcursion',
  )
  const reasons: string[] = []
  if (independentObservations < minimumIndependentObservations) {
    reasons.push('INSUFFICIENT_INDEPENDENT_OBSERVATIONS')
  }
  if (hitRate.lt(minimumHitRate)) {
    reasons.push('HIT_RATE_BELOW_THRESHOLD')
  }
  if (meanBenchmarkRelativeReturn.lt(minimumMeanBenchmarkRelativeReturn)) {
    reasons.push('BENCHMARK_RELATIVE_RETURN_BELOW_THRESHOLD')
  }
  if (worstMaximumAdverseExcursion.lt(minimumAllowedMaximumAdverseExcursion)) {
    reasons.push('ADVERSE_EXCURSION_BELOW_LIMIT')
  }
  if (policy.requireHoldout && !evidence.holdoutPassed) {
    reasons.push('HOLDOUT_NOT_PASSED')
  }
  return {
    eligible: reasons.length === 0,
    policyVersion: policy.version,
    reasons,
    nextStatus: reasons.length === 0 ? 'eligible' : 'shadow',
  }
}
