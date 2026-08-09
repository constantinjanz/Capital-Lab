import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { createSupabaseServerClient } from '@/lib/auth/supabase/server'
import type { Database } from '@/lib/supabase/database.types'

export type HostedBudgetStatus =
  | { available: false; reason: string }
  | {
      available: true
      limits: {
        tradingDaySoft: string
        tradingDayHard: string
        monthlySoft: string
        monthlyHard: string
        experimentHard: string
        lifetimeHard: string
      }
      alerts: readonly {
        scopeKind: string
        scopeKey: string
        thresholdPercent: 70 | 90 | 100
        usedAmount: string
        limitAmount: string
        emittedAt: string
        acknowledgedAt: string | null
      }[]
    }

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Hosted budget status is invalid')
  }
  return value as Record<string, unknown>
}

function text(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Hosted budget status text is invalid')
  }
  return value
}

function decimal(value: unknown): string {
  const result = text(value)
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(result)) {
    throw new Error('Hosted budget decimal is invalid')
  }
  return result
}

export function mapHostedBudgetStatus(value: unknown): HostedBudgetStatus {
  const data = object(value)
  if (data.available === false) {
    return { available: false, reason: text(data.reason) }
  }
  if (data.available !== true || !Array.isArray(data.alerts)) {
    throw new Error('Hosted budget availability is invalid')
  }
  return {
    available: true,
    limits: {
      tradingDaySoft: decimal(data.trading_day_soft_limit),
      tradingDayHard: decimal(data.trading_day_hard_limit),
      monthlySoft: decimal(data.monthly_soft_limit),
      monthlyHard: decimal(data.monthly_hard_limit),
      experimentHard: decimal(data.experiment_hard_limit),
      lifetimeHard: decimal(data.lifetime_hard_limit),
    },
    alerts: data.alerts.map((item) => {
      const alert = object(item)
      if (![70, 90, 100].includes(alert.threshold_percent as number)) {
        throw new Error('Hosted budget threshold is invalid')
      }
      return {
        scopeKind: text(alert.scope_kind),
        scopeKey: text(alert.scope_key),
        thresholdPercent: alert.threshold_percent as 70 | 90 | 100,
        usedAmount: decimal(alert.used_amount),
        limitAmount: decimal(alert.limit_amount),
        emittedAt: text(alert.emitted_at),
        acknowledgedAt:
          alert.acknowledged_at === null ? null : text(alert.acknowledged_at),
      }
    }),
  }
}

export async function readHostedBudgetStatusWithClient(
  client: SupabaseClient<Database>,
): Promise<HostedBudgetStatus> {
  const query = client.rpc(
    'hosted_budget_threshold_status' as keyof Database['public']['Functions'],
  ) as unknown as Promise<{ data: unknown; error: unknown }>
  const { data, error } = await query
  if (error) throw new Error('Hosted budget status read failed')
  return mapHostedBudgetStatus(data)
}

export async function readHostedBudgetStatus(): Promise<HostedBudgetStatus> {
  const client = await createSupabaseServerClient()
  if (!client) throw new Error('Hosted budget status client is unavailable')
  return readHostedBudgetStatusWithClient(client)
}
