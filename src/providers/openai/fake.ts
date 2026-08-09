import type { z } from 'zod'

import type {
  OpenAIGateway,
  PaidCanaryRequest,
  PaidCanaryResult,
  StructuredGenerationRequest,
  StructuredGenerationResult,
  WebResearchRequest,
  WebResearchResult,
} from './types'

export class FakeOpenAIGateway implements OpenAIGateway {
  constructor(private readonly fixtures: Record<string, unknown>) {}

  async generateStructured<TSchema extends z.ZodType>(
    request: StructuredGenerationRequest<TSchema>,
  ): Promise<StructuredGenerationResult<z.infer<TSchema>>> {
    const fixture = this.fixtures[request.schemaName]
    if (fixture === undefined) {
      throw new Error(`Missing fake OpenAI fixture: ${request.schemaName}`)
    }
    return {
      responseId: `fake-${request.schemaName}`,
      output: request.schema.parse(fixture) as z.infer<TSchema>,
      usage: {
        inputTokens: '0',
        cachedInputTokens: '0',
        cacheWriteTokens: '0',
        outputTokens: '0',
        webSearchCalls: '0',
      },
      providerInputTokens: '0',
      reasoningTokens: '0',
      latencyMs: 0,
      finishState: 'completed',
    }
  }

  async researchWeb(request: WebResearchRequest): Promise<WebResearchResult> {
    void request
    const fixture = this.fixtures.web_research
    if (
      !fixture ||
      typeof fixture !== 'object' ||
      !('summary' in fixture) ||
      typeof fixture.summary !== 'string' ||
      !('citations' in fixture) ||
      !Array.isArray(fixture.citations)
    ) {
      throw new Error('Missing fake OpenAI fixture: web_research')
    }
    return {
      responseId: 'fake-web-research',
      summary: fixture.summary,
      citations: fixture.citations as WebResearchResult['citations'],
      usage: {
        inputTokens: '0',
        cachedInputTokens: '0',
        cacheWriteTokens: '0',
        outputTokens: '0',
        webSearchCalls: '1',
      },
      providerInputTokens: '0',
      reasoningTokens: '0',
      latencyMs: 0,
      finishState: 'completed',
    }
  }

  async runPaidCanary(request: PaidCanaryRequest): Promise<PaidCanaryResult> {
    return {
      responseId: `fake-canary-${request.model}`,
      outputText: 'OK',
      usage: {
        inputTokens: '8',
        cachedInputTokens: '0',
        cacheWriteTokens: '0',
        outputTokens: '1',
        webSearchCalls: '0',
      },
      providerInputTokens: '8',
      reasoningTokens: '0',
      latencyMs: 0,
      finishState: 'completed',
    }
  }
}

export class DisabledOpenAIGateway implements OpenAIGateway {
  async generateStructured<TSchema extends z.ZodType>(
    request: StructuredGenerationRequest<TSchema>,
  ): Promise<StructuredGenerationResult<z.infer<TSchema>>> {
    void request
    throw new Error('OpenAI gateway is disabled by configuration')
  }

  async researchWeb(request: WebResearchRequest): Promise<WebResearchResult> {
    void request
    throw new Error('OpenAI gateway is disabled by configuration')
  }

  async runPaidCanary(request: PaidCanaryRequest): Promise<PaidCanaryResult> {
    void request
    throw new Error('OpenAI gateway is disabled by configuration')
  }
}
