import { RUNTIME_PROMPTS } from '@/domain/agent/prompts'
import {
  authorizeControlledWebResearch,
  routeLuna,
  routeSol,
  routeTerra,
  type AgentRole,
  type AgentRoutingPolicy,
  type ExceptionalSolReason,
} from '@/domain/agent/routing'
import type { LunaDecision, TradeProposal } from '@/domain/agent/schemas'
import {
  lunaDecisionSchema,
  tradeProposalSchema,
  validateProposalSemantics,
} from '@/domain/agent/schemas'
import { InMemoryBudgetGuard } from '@/domain/budgets/guard'
import type { ModelId } from '@/domain/budgets/pricing'
import type { OpenAIGateway, WebResearchResult } from '@/providers/openai/types'

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

export type AgentRoutingConfiguration = AgentRoutingPolicy

type DailyCounts = {
  lunaSlots: Set<string>
  terra: number
  sol: number
  web: number
}

function requireDecisionAt(value: string): void {
  if (!Number.isFinite(Date.parse(value))) {
    throw new TypeError('decisionAt must be a valid timestamp')
  }
}

function tradingMonth(tradingDay: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradingDay)) {
    throw new TypeError('tradingDay must use YYYY-MM-DD')
  }
  return tradingDay.slice(0, 7)
}

export class AgentOrchestrator {
  private readonly countsByDay = new Map<string, DailyCounts>()
  private readonly webCountsByMonth = new Map<string, number>()
  private readonly runsByKey = new Map<
    string,
    Promise<AgentRunResult<unknown>>
  >()

  constructor(
    private readonly gateway: OpenAIGateway,
    private readonly budget: InMemoryBudgetGuard,
    private readonly configuration: AgentRoutingConfiguration,
  ) {}

  private counts(day: string): DailyCounts {
    tradingMonth(day)
    const existing = this.countsByDay.get(day)
    if (existing) return existing
    const value = { lunaSlots: new Set<string>(), terra: 0, sol: 0, web: 0 }
    this.countsByDay.set(day, value)
    return value
  }

  private runOnce<T>(
    key: string,
    work: () => Promise<AgentRunResult<T>>,
  ): Promise<AgentRunResult<T>> {
    const existing = this.runsByKey.get(key)
    if (existing) return existing as Promise<AgentRunResult<T>>
    const pending = work()
    this.runsByKey.set(key, pending)
    return pending
  }

  runLuna(input: {
    runId: string
    tradingDay: string
    decisionAt: string
    slotKey: string
    regularSessionEligible: boolean
    candidateCount: number
    compactCandidates: unknown
  }): Promise<AgentRunResult<LunaDecision>> {
    const key = `ai:${input.runId}:luna`
    return this.runOnce(key, async () => {
      requireDecisionAt(input.decisionAt)
      const counts = this.counts(input.tradingDay)
      const route = routeLuna({
        policy: this.configuration,
        regularSessionEligible: input.regularSessionEligible,
        candidateCount: input.candidateCount,
        slotAlreadyUsed: counts.lunaSlots.has(input.slotKey),
      })
      if (!route.allowed) {
        return {
          status:
            route.reason === 'agent_disabled' ? 'disabled' : 'quota_skipped',
          reason: route.reason,
        }
      }
      const reservation = await this.budget.reserve({
        idempotencyKey: key,
        model: 'gpt-5.6-luna',
        at: input.decisionAt,
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
    })
  }

  runTerra(input: {
    runId: string
    tradingDay: string
    decisionAt: string
    boundedContext: unknown
    qualifyingLunaEvent: boolean
    exceptionalDeterministicTrigger: boolean
  }): Promise<AgentRunResult<TradeProposal>> {
    const key = `ai:${input.runId}:terra`
    return this.runOnce(key, async () => {
      requireDecisionAt(input.decisionAt)
      const counts = this.counts(input.tradingDay)
      const route = routeTerra({
        policy: this.configuration,
        qualifyingLunaEvent: input.qualifyingLunaEvent,
        exceptionalDeterministicTrigger: input.exceptionalDeterministicTrigger,
        dailyCount: counts.terra,
      })
      if (!route.allowed) {
        return {
          status:
            route.reason === 'agent_disabled' ? 'disabled' : 'quota_skipped',
          reason: route.reason,
        }
      }
      const reservation = await this.budget.reserve({
        idempotencyKey: key,
        model: 'gpt-5.6-terra',
        at: input.decisionAt,
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
    })
  }

  runSol(input: {
    runId: string
    tradingDay: string
    decisionAt: string
    exceptionalContext: unknown
    terraRequestedEscalation: boolean
    exceptionalReason: ExceptionalSolReason | null
  }): Promise<AgentRunResult<TradeProposal>> {
    const key = `ai:${input.runId}:sol`
    return this.runOnce(key, async () => {
      requireDecisionAt(input.decisionAt)
      const counts = this.counts(input.tradingDay)
      const route = routeSol({
        policy: this.configuration,
        terraRequestedEscalation: input.terraRequestedEscalation,
        exceptionalReason: input.exceptionalReason,
        dailyCount: counts.sol,
      })
      if (!route.allowed) {
        return {
          status:
            route.reason === 'sol_disabled' ? 'disabled' : 'quota_skipped',
          reason: route.reason,
        }
      }
      const reservation = await this.budget.reserve({
        idempotencyKey: key,
        model: 'gpt-5.6-sol',
        at: input.decisionAt,
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
    })
  }

  runControlledWebResearch(input: {
    runId: string
    tradingDay: string
    decisionAt: string
    requestingRole: AgentRole
    query: string
    relevantCandidate: boolean
    structuredSourcesChecked: boolean
    structuredSourceGap: boolean
    allowedDomains?: readonly string[]
  }): Promise<AgentRunResult<WebResearchResult>> {
    const key = `ai:${input.runId}:web_search`
    return this.runOnce(key, async () => {
      requireDecisionAt(input.decisionAt)
      const query = input.query.trim()
      if (query.length === 0 || query.length > 500) {
        throw new TypeError(
          'web research query must contain 1 to 500 characters',
        )
      }
      if (
        input.allowedDomains !== undefined &&
        (input.allowedDomains.length === 0 ||
          input.allowedDomains.length > 10 ||
          input.allowedDomains.some(
            (domain) => !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(domain),
          ))
      ) {
        throw new TypeError('allowed web domains are invalid')
      }
      const counts = this.counts(input.tradingDay)
      const month = tradingMonth(input.tradingDay)
      const monthlyCount = this.webCountsByMonth.get(month) ?? 0
      const route = authorizeControlledWebResearch({
        policy: this.configuration,
        requestingRole: input.requestingRole,
        relevantCandidate: input.relevantCandidate,
        structuredSourcesChecked: input.structuredSourcesChecked,
        structuredSourceGap: input.structuredSourceGap,
        dailyCount: counts.web,
        monthlyCount,
      })
      if (!route.allowed) {
        return {
          status:
            route.reason === 'web_search_disabled'
              ? 'disabled'
              : 'quota_skipped',
          reason: route.reason,
        }
      }
      if (input.requestingRole === 'luna') {
        return { status: 'quota_skipped', reason: 'luna_web_search_forbidden' }
      }
      const model =
        input.requestingRole === 'terra'
          ? ('gpt-5.6-terra' as const)
          : ('gpt-5.6-sol' as const)
      const reservation = await this.budget.reserve({
        idempotencyKey: key,
        model,
        at: input.decisionAt,
        worstCaseUsage: {
          inputTokens: '4000',
          cachedInputTokens: '0',
          cacheWriteTokens: '0',
          outputTokens: '800',
          webSearchCalls: '1',
        },
      })
      if (!reservation.accepted) {
        return { status: 'budget_skipped', reason: reservation.reason }
      }
      counts.web += 1
      this.webCountsByMonth.set(month, monthlyCount + 1)
      try {
        const result = await this.gateway.researchWeb({
          model,
          query,
          maxOutputTokens: 800,
          allowedDomains: input.allowedDomains,
        })
        const settled = await this.budget.settle(key, result.usage)
        return {
          status: 'completed',
          model,
          output: result,
          responseId: result.responseId,
          costUsd: settled.actualUsd,
        }
      } catch (error) {
        await this.budget.markUnknown(key)
        return {
          status: 'failed_unknown_cost',
          model,
          reason: error instanceof Error ? error.name : 'unknown_error',
        }
      }
    })
  }
}
