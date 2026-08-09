import {
  calculateUsageCost,
  CURRENT_MODEL_PRICING,
  type ModelId,
  type TokenUsage,
} from '@/domain/budgets/pricing'
import { decimal } from '@/domain/financial/decimal'
import type { OpenAIGateway, PaidCanaryResult } from '@/providers/openai/types'

const CONFIRMATION = 'MAX_0_01_USD'
const MAXIMUM_TOTAL_USD = '0.01'
const MODELS = [
  'gpt-5.6-luna',
  'gpt-5.6-terra',
  'gpt-5.6-sol',
] as const satisfies readonly ModelId[]

const WORST_CASE_USAGE: TokenUsage = {
  inputTokens: '128',
  cachedInputTokens: '0',
  cacheWriteTokens: '0',
  outputTokens: '16',
  webSearchCalls: '0',
}

export type PaidCanaryConfiguration = {
  agentEnabled: boolean
  autonomousPaperExecutionEnabled: boolean
  paidModelCallsEnabled: boolean
  canaryEnabled: boolean
  webSearchEnabled: boolean
  previewLike: boolean
}

export type PaidCanaryReservation = {
  reservationId: string
  reservedUsd: string
}

export interface PaidCanaryBudgetLedger {
  reserve(input: {
    model: ModelId
    idempotencyKey: string
    worstCaseUsage: TokenUsage
  }): Promise<
    | { accepted: true; reservation: PaidCanaryReservation }
    | { accepted: false; reason: string }
  >
  settle(reservationId: string, result: PaidCanaryResult): Promise<void>
  markUnknown(reservationId: string): Promise<void>
  release(reservationId: string): Promise<void>
}

export type PaidCanaryOutcome = {
  status: 'blocked' | 'completed' | 'stopped'
  reason: string
  calls: number
  reservedUsd: string
  modelsCompleted: readonly ModelId[]
}

function providerStopsSequence(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const status =
    'status' in error ? (error as { status?: unknown }).status : null
  const code = 'code' in error ? String((error as { code?: unknown }).code) : ''
  return (
    status === 401 ||
    status === 402 ||
    status === 403 ||
    status === 429 ||
    /billing|credit|quota/i.test(code)
  )
}

function isSafeConfiguration(configuration: PaidCanaryConfiguration): boolean {
  return (
    !configuration.agentEnabled &&
    !configuration.autonomousPaperExecutionEnabled &&
    configuration.paidModelCallsEnabled &&
    configuration.canaryEnabled &&
    !configuration.webSearchEnabled &&
    !configuration.previewLike
  )
}

export async function runPaidOpenAICanary(input: {
  confirmation: string | undefined
  operationId: string
  configuration: PaidCanaryConfiguration
  gateway: OpenAIGateway
  ledger: PaidCanaryBudgetLedger
  acquireOneShotLock(operationId: string): Promise<boolean>
}): Promise<PaidCanaryOutcome> {
  if (!isSafeConfiguration(input.configuration)) {
    return {
      status: 'blocked',
      reason: 'unsafe_or_disabled_configuration',
      calls: 0,
      reservedUsd: '0',
      modelsCompleted: [],
    }
  }
  if (input.confirmation !== CONFIRMATION) {
    return {
      status: 'blocked',
      reason: 'exact_paid_confirmation_required',
      calls: 0,
      reservedUsd: '0',
      modelsCompleted: [],
    }
  }

  let localWorstCase = decimal('0')
  for (const model of MODELS) {
    localWorstCase = localWorstCase.plus(
      calculateUsageCost(CURRENT_MODEL_PRICING[model], WORST_CASE_USAGE),
    )
  }
  if (localWorstCase.gt(MAXIMUM_TOTAL_USD)) {
    return {
      status: 'blocked',
      reason: 'local_canary_budget_exceeded',
      calls: 0,
      reservedUsd: '0',
      modelsCompleted: [],
    }
  }
  if (!(await input.acquireOneShotLock(input.operationId))) {
    return {
      status: 'blocked',
      reason: 'one_shot_lock_unavailable',
      calls: 0,
      reservedUsd: '0',
      modelsCompleted: [],
    }
  }

  const reservations: Array<{
    model: ModelId
    reservation: PaidCanaryReservation
  }> = []
  let totalReserved = decimal('0')
  for (const model of MODELS) {
    const result = await input.ledger.reserve({
      model,
      idempotencyKey: `paid-canary:${input.operationId}:${model}`,
      worstCaseUsage: WORST_CASE_USAGE,
    })
    if (!result.accepted) {
      await Promise.all(
        reservations.map(({ reservation }) =>
          input.ledger.release(reservation.reservationId),
        ),
      )
      return {
        status: 'blocked',
        reason: `budget_guard_${result.reason}`,
        calls: 0,
        reservedUsd: '0',
        modelsCompleted: [],
      }
    }
    totalReserved = totalReserved.plus(result.reservation.reservedUsd)
    reservations.push({ model, reservation: result.reservation })
  }
  if (totalReserved.gt(MAXIMUM_TOTAL_USD)) {
    await Promise.all(
      reservations.map(({ reservation }) =>
        input.ledger.release(reservation.reservationId),
      ),
    )
    return {
      status: 'blocked',
      reason: 'budget_ledger_canary_cap_exceeded',
      calls: 0,
      reservedUsd: '0',
      modelsCompleted: [],
    }
  }

  const completed: ModelId[] = []
  let calls = 0
  for (let index = 0; index < reservations.length; index += 1) {
    const { model, reservation } = reservations[index]
    try {
      calls += 1
      const result = await input.gateway.runPaidCanary({ model })
      if (
        result.finishState !== 'completed' ||
        result.outputText.trim() !== 'OK'
      ) {
        throw new Error('Canary response did not match the fixed contract')
      }
      await input.ledger.settle(reservation.reservationId, result)
      completed.push(model)
    } catch (error) {
      await input.ledger.markUnknown(reservation.reservationId)
      await Promise.all(
        reservations
          .slice(index + 1)
          .map((pending) =>
            input.ledger.release(pending.reservation.reservationId),
          ),
      )
      return {
        status: 'stopped',
        reason:
          index === 0 && providerStopsSequence(error)
            ? 'luna_auth_billing_or_quota_failure'
            : 'provider_result_unknown',
        calls,
        reservedUsd: totalReserved.toString(),
        modelsCompleted: completed,
      }
    }
  }
  return {
    status: 'completed',
    reason: 'canary_completed',
    calls,
    reservedUsd: totalReserved.toString(),
    modelsCompleted: completed,
  }
}
