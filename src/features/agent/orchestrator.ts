import type { LunaDecision, TradeProposal } from '@/domain/agent/schemas'
import {
  lunaDecisionSchema,
  tradeProposalSchema,
  validateProposalSemantics,
} from '@/domain/agent/schemas'
import { RUNTIME_PROMPTS } from '@/domain/agent/prompts'
import type { ModelId } from '@/domain/budgets/pricing'
import { InMemoryBudgetGuard } from '@/domain/budgets/guard'
import type { OpenAIGateway } from '@/providers/openai/types'

export type AgentRunStatus =
  | 'completed'
  | 'disabled'
  | 'budget_skipped'
  | 'quota_skipped'
  | 'failed_unknown_cost'

export type AgentRunResult<T> = {
  status: AgentRunStatus
  model?: ModelId
  output?: T
  responseId?: string
  reason?: string
  costUsd?: string
}

export type AgentRoutingConfiguration = {
  enabled: boolean
  solEnabled: boolean
  terraDailyCap: number
  solDailyCap: number
}

type Counts = { lunaSlots: Set<string>; terra: number; sol: number }

export class AgentOrchestrator {
  private readonly countsByDay = new Map<string, Counts>()

  constructor(
    private readonly gateway: OpenAIGateway,
    private readonly budget: InMemoryBudgetGuard,
    private readonly configuration: AgentRoutingConfiguration,
  ) {}

  private counts(day: string): Counts {
    const existing = this.countsByDay.get(day)
    if (existing) return existing
    const value = { lunaSlots: new Set<string>(), terra: 0, sol: 0 }
    this.countsByDay.set(day, value)
    return value
  }

  async runLuna(input: {
    runId: string
    tradingDay: string
    slotKey: string
    compactCandidates: unknown
  }): Promise<AgentRunResult<LunaDecision>> {
    if (!this.configuration.enabled)
      return { status: 'disabled', reason: 'agent_disabled' }
    const counts = this.counts(input.tradingDay)
    if (counts.lunaSlots.has(input.slotKey)) {
      return { status: 'quota_skipped', reason: 'luna_slot_already_used' }
    }
    const key = `ai:${input.runId}:luna`
    const reservation = await this.budget.reserve({
      idempotencyKey: key,
      model: 'gpt-5.6-luna',
      at: new Date().toISOString(),
      worstCaseUsage: {
        inputTokens: '8000',
        cachedInputTokens: '0',
        cacheWriteTokens: '0',
        outputTokens: '500',
        webSearchCalls: '0',
      },
    })
    if (!reservation.accepted) {
      return { status: 'budget_skipped', reason: reservation.reason }
    }
    counts.lunaSlots.add(input.slotKey)
    try {
      const result = await this.gateway.generateStructured({
        model: 'gpt-5.6-luna',
        schemaName: 'luna_relevance',
        schema: lunaDecisionSchema,
        system: RUNTIME_PROMPTS.luna.content,
        input: JSON.stringify(input.compactCandidates),
        maxOutputTokens: 500,
        reasoningEffort: 'low',
      })
      const settled = await this.budget.settle(key, result.usage)
      return {
        status: 'completed',
        model: 'gpt-5.6-luna',
        output: result.output,
        responseId: result.responseId,
        costUsd: settled.actualUsd,
      }
    } catch (error) {
      await this.budget.markUnknown(key)
      return {
        status: 'failed_unknown_cost',
        model: 'gpt-5.6-luna',
        reason: error instanceof Error ? error.name : 'unknown_error',
      }
    }
  }

  async runTerra(input: {
    runId: string
    tradingDay: string
    boundedContext: unknown
  }): Promise<AgentRunResult<TradeProposal>> {
    if (!this.configuration.enabled)
      return { status: 'disabled', reason: 'agent_disabled' }
    const counts = this.counts(input.tradingDay)
    if (counts.terra >= this.configuration.terraDailyCap) {
      return { status: 'quota_skipped', reason: 'terra_daily_cap' }
    }
    const key = `ai:${input.runId}:terra`
    const reservation = await this.budget.reserve({
      idempotencyKey: key,
      model: 'gpt-5.6-terra',
      at: new Date().toISOString(),
      worstCaseUsage: {
        inputTokens: '12000',
        cachedInputTokens: '0',
        cacheWriteTokens: '0',
        outputTokens: '1500',
        webSearchCalls: '0',
      },
    })
    if (!reservation.accepted) {
      return { status: 'budget_skipped', reason: reservation.reason }
    }
    counts.terra += 1
    try {
      const result = await this.gateway.generateStructured({
        model: 'gpt-5.6-terra',
        schemaName: 'terra_trade_proposal',
        schema: tradeProposalSchema,
        system: RUNTIME_PROMPTS.terra.content,
        input: JSON.stringify(input.boundedContext),
        maxOutputTokens: 1500,
        reasoningEffort: 'medium',
      })
      const settled = await this.budget.settle(key, result.usage)
      return {
        status: 'completed',
        model: 'gpt-5.6-terra',
        output: validateProposalSemantics(result.output),
        responseId: result.responseId,
        costUsd: settled.actualUsd,
      }
    } catch (error) {
      await this.budget.markUnknown(key)
      return {
        status: 'failed_unknown_cost',
        model: 'gpt-5.6-terra',
        reason: error instanceof Error ? error.name : 'unknown_error',
      }
    }
  }

  async runSol(input: {
    runId: string
    tradingDay: string
    exceptionalContext: unknown
    terraRequestedEscalation: boolean
  }): Promise<AgentRunResult<TradeProposal>> {
    if (!this.configuration.enabled || !this.configuration.solEnabled) {
      return { status: 'disabled', reason: 'sol_disabled' }
    }
    if (!input.terraRequestedEscalation) {
      return {
        status: 'quota_skipped',
        reason: 'terra_did_not_request_escalation',
      }
    }
    const counts = this.counts(input.tradingDay)
    if (counts.sol >= this.configuration.solDailyCap) {
      return { status: 'quota_skipped', reason: 'sol_daily_cap' }
    }
    const key = `ai:${input.runId}:sol`
    const reservation = await this.budget.reserve({
      idempotencyKey: key,
      model: 'gpt-5.6-sol',
      at: new Date().toISOString(),
      worstCaseUsage: {
        inputTokens: '16000',
        cachedInputTokens: '0',
        cacheWriteTokens: '0',
        outputTokens: '2000',
        webSearchCalls: '0',
      },
    })
    if (!reservation.accepted) {
      return { status: 'budget_skipped', reason: reservation.reason }
    }
    counts.sol += 1
    try {
      const result = await this.gateway.generateStructured({
        model: 'gpt-5.6-sol',
        schemaName: 'sol_trade_proposal',
        schema: tradeProposalSchema,
        system: RUNTIME_PROMPTS.sol.content,
        input: JSON.stringify(input.exceptionalContext),
        maxOutputTokens: 2000,
        reasoningEffort: 'high',
      })
      const settled = await this.budget.settle(key, result.usage)
      return {
        status: 'completed',
        model: 'gpt-5.6-sol',
        output: validateProposalSemantics(result.output),
        responseId: result.responseId,
        costUsd: settled.actualUsd,
      }
    } catch (error) {
      await this.budget.markUnknown(key)
      return {
        status: 'failed_unknown_cost',
        model: 'gpt-5.6-sol',
        reason: error instanceof Error ? error.name : 'unknown_error',
      }
    }
  }
}
