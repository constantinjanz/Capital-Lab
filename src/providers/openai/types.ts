import type { z } from 'zod'

import type { ModelId, TokenUsage } from '@/domain/budgets/pricing'

export type StructuredGenerationRequest<TSchema extends z.ZodType> = {
  model: ModelId
  schemaName: string
  schema: TSchema
  system: string
  input: string
  maxOutputTokens: number
  reasoningEffort: 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
}

export type StructuredGenerationResult<T> = {
  responseId: string
  output: T
  usage: TokenUsage
  providerInputTokens: string
  reasoningTokens: string
  latencyMs: number
  finishState: 'completed' | 'incomplete'
}

export type WebResearchRequest = {
  model: Extract<ModelId, 'gpt-5.6-terra' | 'gpt-5.6-sol'>
  query: string
  maxOutputTokens: number
  allowedDomains?: readonly string[]
}

export type WebResearchCitation = {
  title: string
  url: string
}

export type WebResearchResult = {
  responseId: string
  summary: string
  citations: readonly WebResearchCitation[]
  usage: TokenUsage
  providerInputTokens: string
  reasoningTokens: string
  latencyMs: number
  finishState: 'completed' | 'incomplete'
}

export interface OpenAIGateway {
  generateStructured<TSchema extends z.ZodType>(
    request: StructuredGenerationRequest<TSchema>,
  ): Promise<StructuredGenerationResult<z.infer<TSchema>>>
  researchWeb(request: WebResearchRequest): Promise<WebResearchResult>
}
