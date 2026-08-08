import type { ServerEnvironment } from '@/lib/env/server'

export type HostedAgentRuntimeReadiness =
  | {
      ready: false
      code: 'disabled' | 'environment_invalid' | 'live_paper_unavailable'
      message: string
    }
  | { ready: true; code: 'shadow_ready'; message: string }

type RuntimeEnvironment = Pick<
  ServerEnvironment,
  | 'AGENT_ENABLED'
  | 'AGENT_EXECUTION_MODE'
  | 'OPENAI_API_KEY'
  | 'SUPABASE_SECRET_KEY'
>

export function deriveHostedAgentRuntimeReadiness(
  environment: RuntimeEnvironment,
): HostedAgentRuntimeReadiness {
  if (!environment.AGENT_ENABLED) {
    return {
      ready: false,
      code: 'disabled',
      message:
        'Agent calls are disabled by the server. Persisted runs remain owner-readable and no paid provider call can start.',
    }
  }
  if (!environment.OPENAI_API_KEY || !environment.SUPABASE_SECRET_KEY) {
    return {
      ready: false,
      code: 'environment_invalid',
      message:
        'The server-only runtime configuration is incomplete. No provider call can start.',
    }
  }
  if (environment.AGENT_EXECUTION_MODE !== 'shadow') {
    return {
      ready: false,
      code: 'live_paper_unavailable',
      message:
        'Hosted live-paper execution is not enabled. The reviewed hosted runtime accepts shadow proposals only.',
    }
  }
  return {
    ready: true,
    code: 'shadow_ready',
    message:
      'The server runtime is configured for structured shadow proposals. Broker connectivity remains permanently unavailable.',
  }
}
