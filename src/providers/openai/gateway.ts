import 'server-only'

import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import type { z } from 'zod'

import type {
  OpenAIGateway,
  StructuredGenerationRequest,
  StructuredGenerationResult,
} from './types'

function usageField(record: unknown, path: readonly string[]): number {
  let current = record
  for (const key of path) {
    if (!current || typeof current !== 'object' || !(key in current)) return 0
    current = (current as Record<string, unknown>)[key]
  }
  return typeof current === 'number' && Number.isSafeInteger(current)
    ? current
    : 0
}

/** The only service in the repository allowed to import the OpenAI SDK. */
export class ResponsesOpenAIGateway implements OpenAIGateway {
  private readonly client: OpenAI

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey, maxRetries: 0, timeout: 30_000 })
  }

  async generateStructured<TSchema extends z.ZodType>(
    request: StructuredGenerationRequest<TSchema>,
  ): Promise<StructuredGenerationResult<z.infer<TSchema>>> {
    const startedAt = performance.now()
    const response = await this.client.responses.parse({
      model: request.model,
      store: false,
      max_output_tokens: request.maxOutputTokens,
      reasoning: { effort: request.reasoningEffort },
      input: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.input },
      ],
      text: { format: zodTextFormat(request.schema, request.schemaName) },
    })
    if (response.output_parsed === null) {
      throw new Error('OpenAI returned no parsed structured output')
    }
    const totalInputTokens = usageField(response.usage, ['input_tokens'])
    const cachedInputTokens = usageField(response.usage, [
      'input_tokens_details',
      'cached_tokens',
    ])
    return {
      responseId: response.id,
      output: request.schema.parse(response.output_parsed) as z.infer<TSchema>,
      usage: {
        inputTokens: String(Math.max(0, totalInputTokens - cachedInputTokens)),
        cachedInputTokens: String(cachedInputTokens),
        cacheWriteTokens: String(
          usageField(response.usage, [
            'input_tokens_details',
            'cache_write_tokens',
          ]),
        ),
        outputTokens: String(usageField(response.usage, ['output_tokens'])),
        webSearchCalls: '0',
      },
      latencyMs: Math.round(performance.now() - startedAt),
      finishState: response.status === 'completed' ? 'completed' : 'incomplete',
    }
  }
}
