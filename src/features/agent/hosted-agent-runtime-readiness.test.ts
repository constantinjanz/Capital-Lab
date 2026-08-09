import { describe, expect, it } from 'vitest'

import { deriveHostedAgentRuntimeReadiness } from './hosted-agent-runtime-readiness'

const environment = {
  AGENT_ENABLED: false,
  AGENT_EXECUTION_MODE: 'shadow' as const,
  OPENAI_API_KEY: undefined,
  SUPABASE_SECRET_KEY: undefined,
}

describe('deriveHostedAgentRuntimeReadiness', () => {
  it('keeps paid calls disabled by default', () => {
    expect(deriveHostedAgentRuntimeReadiness(environment)).toMatchObject({
      ready: false,
      code: 'disabled',
    })
  })

  it('fails closed when a server-only runtime credential is absent', () => {
    expect(
      deriveHostedAgentRuntimeReadiness({
        ...environment,
        AGENT_ENABLED: true,
        OPENAI_API_KEY: 'provider-key',
      }),
    ).toMatchObject({ ready: false, code: 'environment_invalid' })
  })

  it('does not present live-paper mode as hosted-ready', () => {
    expect(
      deriveHostedAgentRuntimeReadiness({
        ...environment,
        AGENT_ENABLED: true,
        AGENT_EXECUTION_MODE: 'live_paper',
        OPENAI_API_KEY: 'provider-key',
        SUPABASE_SECRET_KEY: 'database-key',
      }),
    ).toMatchObject({ ready: false, code: 'live_paper_unavailable' })
  })

  it('reports readiness only for the credentialed shadow runtime', () => {
    expect(
      deriveHostedAgentRuntimeReadiness({
        ...environment,
        AGENT_ENABLED: true,
        OPENAI_API_KEY: 'provider-key',
        SUPABASE_SECRET_KEY: 'database-key',
      }),
    ).toMatchObject({ ready: true, code: 'shadow_ready' })
  })
})
