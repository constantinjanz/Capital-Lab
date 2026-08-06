import 'server-only'

import { getServerEnvironment } from '@/lib/env/server'

import { DisabledOpenAIGateway } from './fake'
import { ResponsesOpenAIGateway } from './gateway'
import type { OpenAIGateway } from './types'

export function createOpenAIGateway(): OpenAIGateway {
  const environment = getServerEnvironment()
  if (!environment.AGENT_ENABLED || !environment.OPENAI_API_KEY) {
    return new DisabledOpenAIGateway()
  }
  return new ResponsesOpenAIGateway(environment.OPENAI_API_KEY)
}
