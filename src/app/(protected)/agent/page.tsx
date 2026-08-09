import type { Metadata } from 'next'

import { AgentView } from '@/features/agent/agent-view'
import { HostedAgentView } from '@/features/agent/hosted-agent-view'
import { deriveHostedAgentRuntimeReadiness } from '@/features/agent/hosted-agent-runtime-readiness'
import type { HostedAgentRuntimeReadiness } from '@/features/agent/hosted-agent-runtime-readiness'
import { requireOwner } from '@/lib/auth/require-owner'
import { getServerEnvironment } from '@/lib/env/server'
import { mockRepository } from '@/lib/mock/repository'
import {
  decisionAtForHostedAgentConsoleRead,
  readHostedAgentConsole,
} from '@/lib/supabase/agent-console-read-repository'

export const metadata: Metadata = { title: 'Agent console' }

function hostedAgentRuntimeReadiness(): HostedAgentRuntimeReadiness {
  try {
    return deriveHostedAgentRuntimeReadiness(getServerEnvironment())
  } catch {
    return {
      ready: false,
      code: 'environment_invalid',
      message:
        'The server-side runtime environment is invalid. No provider call can start.',
    }
  }
}

export default async function AgentPage() {
  const identity = await requireOwner()
  if (identity.mode === 'mock') {
    return <AgentView data={mockRepository.getAgent()} />
  }

  const decisionAt = decisionAtForHostedAgentConsoleRead()
  const console = await readHostedAgentConsole(identity.id, decisionAt).catch(
    () => null,
  )
  return (
    <HostedAgentView
      console={console}
      runtime={hostedAgentRuntimeReadiness()}
      decisionAt={decisionAt}
    />
  )
}
