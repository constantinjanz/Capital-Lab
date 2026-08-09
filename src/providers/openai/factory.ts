import 'server-only'

import { getServerEnvironment } from '@/lib/env/server'

import { DisabledOpenAIGateway } from './fake'
import { ResponsesOpenAIGateway } from './gateway'
import type { OpenAIGateway } from './types'

export function createOpenAIGateway(
  purpose: 'agent' | 'canary' = 'agent',
): OpenAIGateway {
  const environment = getServerEnvironment()
  const previewLike =
    process.env.VERCEL_ENV !== undefined &&
    process.env.VERCEL_ENV !== 'production'
  const purposeEnabled =
    purpose === 'agent'
      ? environment.AGENT_ENABLED &&
        environment.PAID_MODEL_CALLS_ENABLED &&
        environment.AGENT_EXECUTION_MODE === 'shadow'
      : environment.OPENAI_CANARY_ENABLED &&
        environment.PAID_MODEL_CALLS_ENABLED &&
        !environment.AGENT_ENABLED &&
        !environment.AUTONOMOUS_PAPER_EXECUTION_ENABLED &&
        !environment.OPENAI_WEB_SEARCH_ENABLED
  if (previewLike || !purposeEnabled || !environment.OPENAI_API_KEY) {
    return new DisabledOpenAIGateway()
  }
  return new ResponsesOpenAIGateway(environment.OPENAI_API_KEY)
}
