import 'server-only'

import { createHash } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { ModelId } from '@/domain/budgets/pricing'
import type { PaidCanaryBudgetLedger } from '@/features/agent/paid-canary'
import type { Database } from '@/lib/supabase/database.types'

type CanaryContext = {
  ownerId: string
  budgetPolicyId: string
  pricingIds: Record<ModelId, string>
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Paid Canary returned invalid ${label}`)
  }
  return value as Record<string, unknown>
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Paid Canary returned invalid ${label}`)
  }
  return value
}

function integer(value: string, label: string): number {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`Paid Canary ${label} is not a canonical integer`)
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Paid Canary ${label} is outside the supported range`)
  }
  return parsed
}

async function rpc(
  client: SupabaseClient<Database>,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const query = client.rpc(
    name as keyof Database['public']['Functions'],
    args as never,
  ) as unknown as {
    abortSignal(signal: AbortSignal): Promise<{ data: unknown; error: unknown }>
  }
  const { data, error } = await query.abortSignal(AbortSignal.timeout(15_000))
  if (error) throw new Error(`Paid Canary database ${name} failed`)
  return data
}

export async function loadPaidCanaryContext(
  client: SupabaseClient<Database>,
  requestedAt: string,
): Promise<CanaryContext> {
  const data = record(
    await rpc(client, 'paid_canary_context', { p_requested_at: requestedAt }),
    'context',
  )
  const pricing = record(data.pricing_ids, 'pricing map')
  const pricingIds = {
    'gpt-5.6-luna': text(pricing['gpt-5.6-luna'], 'Luna pricing ID'),
    'gpt-5.6-terra': text(pricing['gpt-5.6-terra'], 'Terra pricing ID'),
    'gpt-5.6-sol': text(pricing['gpt-5.6-sol'], 'Sol pricing ID'),
  }
  return {
    ownerId: text(data.owner_id, 'owner ID'),
    budgetPolicyId: text(data.budget_policy_id, 'budget policy ID'),
    pricingIds,
  }
}

export function createPaidCanaryBudgetLedger(input: {
  client: SupabaseClient<Database>
  context: CanaryContext
  requestedAt: string
}): PaidCanaryBudgetLedger {
  return {
    async reserve(request) {
      const requestHash = createHash('sha256')
        .update(
          JSON.stringify({
            contract: 'capital_lab_paid_canary_v1',
            model: request.model,
            idempotencyKey: request.idempotencyKey,
            usage: request.worstCaseUsage,
          }),
        )
        .digest('hex')
      const data = record(
        await rpc(input.client, 'reserve_ai_budget', {
          p_owner_id: input.context.ownerId,
          p_experiment_id: null,
          p_agent_run_id: null,
          p_budget_policy_id: input.context.budgetPolicyId,
          p_pricing_id: input.context.pricingIds[request.model],
          p_call_kind: request.model.replace('gpt-5.6-', ''),
          p_max_input_tokens: integer(
            request.worstCaseUsage.inputTokens,
            'maximum input tokens',
          ),
          p_max_output_tokens: integer(
            request.worstCaseUsage.outputTokens,
            'maximum output tokens',
          ),
          p_max_tool_calls: 0,
          p_requested_at: input.requestedAt,
          p_idempotency_key: request.idempotencyKey,
          p_request_hash: requestHash,
        }),
        'reservation',
      )
      if (data.allowed !== true) {
        return {
          accepted: false,
          reason:
            typeof data.reason === 'string'
              ? data.reason.replace(/[^a-z0-9_]/gi, '_').toLowerCase()
              : 'unknown_budget_state',
        }
      }
      return {
        accepted: true,
        reservation: {
          reservationId: text(data.reservation_id, 'reservation ID'),
          reservedUsd: text(data.reserved_amount, 'reserved amount'),
        },
      }
    },
    async settle(reservationId, result) {
      await rpc(input.client, 'settle_ai_budget', {
        p_owner_id: input.context.ownerId,
        p_reservation_id: reservationId,
        p_provider_response_id: result.responseId,
        p_input_tokens: integer(result.usage.inputTokens, 'input tokens'),
        p_cached_input_tokens: integer(
          result.usage.cachedInputTokens,
          'cached input tokens',
        ),
        p_cache_write_tokens: integer(
          result.usage.cacheWriteTokens,
          'cache-write tokens',
        ),
        p_output_tokens: integer(result.usage.outputTokens, 'output tokens'),
        p_reasoning_tokens: integer(result.reasoningTokens, 'reasoning tokens'),
        p_tool_calls: 0,
        p_web_search_calls: 0,
        p_latency_ms: result.latencyMs,
        p_finish_state: result.finishState,
      })
    },
    async markUnknown(reservationId) {
      await rpc(input.client, 'transition_ai_reservation', {
        p_owner_id: input.context.ownerId,
        p_reservation_id: reservationId,
        p_target_status: 'unknown',
      })
    },
    async release(reservationId) {
      await rpc(input.client, 'transition_ai_reservation', {
        p_owner_id: input.context.ownerId,
        p_reservation_id: reservationId,
        p_target_status: 'released',
      })
    },
  }
}

export async function claimPaidCanary(
  client: SupabaseClient<Database>,
  ownerId: string,
  operationId: string,
): Promise<boolean> {
  const data = await rpc(client, 'claim_paid_canary', {
    p_owner_id: ownerId,
    p_operation_id: operationId,
  })
  if (typeof data !== 'boolean') {
    throw new Error('Paid Canary returned an invalid one-shot lock result')
  }
  return data
}

export type { CanaryContext }
