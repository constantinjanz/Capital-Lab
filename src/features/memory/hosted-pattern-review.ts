import { z } from 'zod'

import {
  decimal,
  decimalValue,
  type FinancialDecimal,
} from '@/domain/financial/decimal'
import { HOSTED_PATTERN_PROMOTION_POLICY_V1 } from '@/domain/memory/patterns'
import type { HostedPatternLifecycleStatus } from '@/features/memory/hosted-learning-snapshot'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COUNT_PATTERN = /^(0|[1-9][0-9]*)$/
const MAX_BIGINT = BigInt('9223372036854775807')
const gateReasonCodes = new Set([
  'POLICY_CONFIG_MISMATCH',
  'INSUFFICIENT_INDEPENDENT_OBSERVATIONS',
  'HIT_RATE_UNAVAILABLE',
  'HIT_RATE_BELOW_THRESHOLD',
  'BENCHMARK_RELATIVE_RETURN_UNAVAILABLE',
  'BENCHMARK_RELATIVE_RETURN_BELOW_THRESHOLD',
  'ADVERSE_EXCURSION_UNAVAILABLE',
  'ADVERSE_EXCURSION_BELOW_LIMIT',
  'HOLDOUT_NOT_PASSED',
])

export const hostedPatternReviewActions = [
  'start_shadow',
  'mark_eligible',
  'reject',
  'retire',
] as const

export type HostedPatternReviewAction =
  (typeof hostedPatternReviewActions)[number]

export const hostedPatternReviewConfirmations: Record<
  HostedPatternReviewAction,
  string
> = {
  start_shadow: 'START PATTERN SHADOW REVIEW',
  mark_eligible: 'MARK PATTERN ELIGIBLE',
  reject: 'REJECT PATTERN',
  retire: 'RETIRE PATTERN',
}

const expectedStatuses = ['proposed', 'shadow', 'eligible', 'active'] as const

const reviewSchema = z
  .object({
    operationId: z.string().uuid('Pattern review operation is invalid'),
    patternId: z.string().uuid('Pattern is invalid'),
    expectedStatus: z.enum(expectedStatuses),
    action: z.enum(hostedPatternReviewActions),
    confirmation: z.string().max(64),
    reason: z.preprocess(
      (value) => (value === null || value === '' ? null : value),
      z.string().max(200).nullable(),
    ),
  })
  .superRefine((value, context) => {
    if (value.confirmation !== hostedPatternReviewConfirmations[value.action]) {
      context.addIssue({
        code: 'custom',
        path: ['confirmation'],
        message: `Enter ${hostedPatternReviewConfirmations[value.action]} exactly`,
      })
    }

    const reason = value.reason?.trim() ?? null
    if (value.action === 'reject' || value.action === 'retire') {
      if (!reason || reason.length < 3) {
        context.addIssue({
          code: 'custom',
          path: ['reason'],
          message: 'Review reason must contain at least 3 characters',
        })
      }
    } else if (reason) {
      context.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'A reason is not accepted for this review action',
      })
    }

    const allowed =
      (value.expectedStatus === 'proposed' &&
        ['start_shadow', 'reject'].includes(value.action)) ||
      (value.expectedStatus === 'shadow' &&
        ['mark_eligible', 'reject', 'retire'].includes(value.action)) ||
      (value.expectedStatus === 'eligible' &&
        ['reject', 'retire'].includes(value.action)) ||
      (value.expectedStatus === 'active' && value.action === 'retire')
    if (!allowed) {
      context.addIssue({
        code: 'custom',
        path: ['action'],
        message:
          'This pattern review action is not valid for the expected status',
      })
    }
  })
  .transform((value) => ({
    ...value,
    reason: value.reason?.trim() || null,
  }))

export type HostedPatternReviewInput = z.infer<typeof reviewSchema>
export type HostedPatternReviewField = keyof HostedPatternReviewInput

export type HostedPatternReviewActionState = {
  status: 'idle' | 'success' | 'error' | 'unknown'
  message?: string
  fieldErrors?: Partial<Record<HostedPatternReviewField, string>>
}

export const initialHostedPatternReviewActionState: HostedPatternReviewActionState =
  { status: 'idle' }

export type HostedPatternReviewParseResult =
  | { success: true; data: HostedPatternReviewInput }
  | { success: false; state: HostedPatternReviewActionState }

export interface HostedPatternReviewResult {
  patternId: string
  lifecycleStatus: HostedPatternLifecycleStatus
  reviewedAt: string
  independentObservations: string
  hitRate: string | null
  meanBenchmarkRelativeReturn: string | null
  worstMaximumAdverseExcursion: string | null
  holdoutPassed: boolean
  gateEligible: boolean
  gateReasons: string[]
  policyVersion: string
  replayed: boolean
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Hosted pattern review has an invalid ${label}`)
  }
  return value
}

function uuid(value: unknown, label: string): string {
  const result = text(value, label)
  if (!UUID_PATTERN.test(result)) {
    throw new Error(`Hosted pattern review has an invalid ${label}`)
  }
  return result
}

function exactDecimal(
  value: unknown,
  label: string,
  validate?: (candidate: FinancialDecimal) => boolean,
): string {
  if (typeof value !== 'string') {
    throw new Error(`Hosted pattern review has an invalid ${label}`)
  }
  try {
    const parsed = decimal(value)
    if (validate && !validate(parsed)) throw new Error('range')
    return decimalValue(parsed)
  } catch {
    throw new Error(`Hosted pattern review has an invalid ${label}`)
  }
}

function nullableExactDecimal(
  value: unknown,
  label: string,
  validate?: (candidate: FinancialDecimal) => boolean,
): string | null {
  return value === null ? null : exactDecimal(value, label, validate)
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`Hosted pattern review has an invalid ${label}`)
  }
  return value
}

function count(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !COUNT_PATTERN.test(value) ||
    BigInt(value) > MAX_BIGINT
  ) {
    throw new Error('Hosted pattern review has an invalid observation count')
  }
  return value
}

function timestamp(value: unknown): string {
  const result = text(value, 'review timestamp')
  if (!Number.isFinite(Date.parse(result))) {
    throw new Error('Hosted pattern review has an invalid review timestamp')
  }
  return result
}

function status(value: unknown): HostedPatternLifecycleStatus {
  const result = text(value, 'lifecycle status')
  if (!['shadow', 'eligible', 'rejected', 'retired'].includes(result)) {
    throw new Error('Hosted pattern review has an invalid lifecycle status')
  }
  return result as HostedPatternLifecycleStatus
}

function reasons(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error('Hosted pattern review has invalid gate reasons')
  }
  const result = value.map((candidate) => text(candidate, 'gate reason'))
  if (
    new Set(result).size !== result.length ||
    result.some((reason) => !gateReasonCodes.has(reason))
  ) {
    throw new Error('Hosted pattern review has invalid gate reasons')
  }
  return result
}

export function parseHostedPatternReviewForm(
  formData: FormData,
): HostedPatternReviewParseResult {
  const parsed = reviewSchema.safeParse({
    operationId: formData.get('operationId'),
    patternId: formData.get('patternId'),
    expectedStatus: formData.get('expectedStatus'),
    action: formData.get('action'),
    confirmation: formData.get('confirmation'),
    reason: formData.get('reason'),
  })
  if (parsed.success) return parsed

  const flattened = parsed.error.flatten().fieldErrors
  return {
    success: false,
    state: {
      status: 'error',
      message: 'Review the pattern lifecycle fields.',
      fieldErrors: {
        operationId: flattened.operationId?.[0],
        patternId: flattened.patternId?.[0],
        expectedStatus: flattened.expectedStatus?.[0],
        action: flattened.action?.[0],
        confirmation: flattened.confirmation?.[0],
        reason: flattened.reason?.[0],
      },
    },
  }
}

export function mapHostedPatternReviewResult(
  result: unknown,
  expectedPatternId: string,
  expectedAction?: HostedPatternReviewAction,
): HostedPatternReviewResult | null {
  if (!Array.isArray(result) || result.length !== 1) return null
  const value = result[0]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>

  try {
    const patternId = uuid(input.pattern_id, 'pattern id')
    if (patternId !== uuid(expectedPatternId, 'expected pattern id'))
      return null
    const policyVersion = text(input.policy_version, 'policy version')
    if (policyVersion !== HOSTED_PATTERN_PROMOTION_POLICY_V1.version)
      return null
    const hitRate = nullableExactDecimal(
      input.hit_rate_text,
      'hit rate',
      (candidate) => candidate.gte(0) && candidate.lte(1),
    )
    const meanBenchmarkRelativeReturn = nullableExactDecimal(
      input.mean_benchmark_relative_return_text,
      'mean benchmark-relative return',
    )
    const worstMaximumAdverseExcursion = nullableExactDecimal(
      input.worst_maximum_adverse_excursion_text,
      'worst maximum adverse excursion',
      (candidate) => candidate.lte(0),
    )
    const gateEligible = boolean(input.gate_eligible, 'gate eligibility')
    const gateReasons = reasons(input.gate_reasons)
    if (gateEligible !== (gateReasons.length === 0)) return null

    const lifecycleStatus = status(input.lifecycle_status)
    const expectedLifecycleStatus = expectedAction
      ? {
          start_shadow: 'shadow',
          mark_eligible: 'eligible',
          reject: 'rejected',
          retire: 'retired',
        }[expectedAction]
      : null
    if (
      expectedLifecycleStatus &&
      lifecycleStatus !== expectedLifecycleStatus
    ) {
      return null
    }

    return {
      patternId,
      lifecycleStatus,
      reviewedAt: timestamp(input.reviewed_at),
      independentObservations: count(input.independent_observations_text),
      hitRate,
      meanBenchmarkRelativeReturn,
      worstMaximumAdverseExcursion,
      holdoutPassed: boolean(input.holdout_passed, 'holdout result'),
      gateEligible,
      gateReasons,
      policyVersion,
      replayed: boolean(input.replayed, 'replay result'),
    }
  } catch {
    return null
  }
}
