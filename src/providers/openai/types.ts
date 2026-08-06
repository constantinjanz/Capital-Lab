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
  latencyMs: number
  finishState: 'completed' | 'incomplete'
}

export interface OpenAIGateway {
  generateStructured<TSchema extends z.ZodType>(
    request: StructuredGenerationRequest<TSchema>,
  ): Promise<StructuredGenerationResult<z.infer<TSchema>>>
}
