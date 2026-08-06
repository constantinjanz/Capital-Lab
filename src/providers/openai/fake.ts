import type { z } from 'zod'

import type {
  OpenAIGateway,
  StructuredGenerationRequest,
  StructuredGenerationResult,
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
}
