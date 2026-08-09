import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import {
  mapHostedAgentConsoleResult,
  type HostedAgentConsole,
} from '@/features/agent/hosted-agent-console'
import { createSupabaseServerClient } from '@/lib/auth/supabase/server'
import { log } from '@/lib/logging/logger'
import type { Database } from '@/lib/supabase/database.types'

export type HostedAgentConsoleClient = SupabaseClient<Database>

const CLOCK_SKEW_BUFFER_MS = 5_000

type ReadOperation = 'agent_console_read' | 'agent_console_validation'

class HostedAgentConsoleInternalError extends Error {
  constructor(readonly operation: ReadOperation) {
    super('Hosted agent console read failed')
    this.name = 'HostedAgentConsoleInternalError'
  }
}

export function decisionAtForHostedAgentConsoleRead(): string {
  return new Date(Date.now() - CLOCK_SKEW_BUFFER_MS).toISOString()
}

async function readWithClient(
  supabase: HostedAgentConsoleClient,
  ownerId: string,
  decisionAt: string,
): Promise<HostedAgentConsole> {
  let result: { data: unknown; error: unknown }
  try {
    result = await supabase.rpc('hosted_agent_console_read', {
      p_decision_at: decisionAt,
      p_run_limit: 100,
    })
  } catch {
    throw new HostedAgentConsoleInternalError('agent_console_read')
  }
  if (result.error) {
    throw new HostedAgentConsoleInternalError('agent_console_read')
  }

  try {
    return mapHostedAgentConsoleResult(result.data, ownerId, decisionAt)
  } catch {
    throw new HostedAgentConsoleInternalError('agent_console_validation')
  }
}

export async function readHostedAgentConsole(
  ownerId: string,
  decisionAt: string,
): Promise<HostedAgentConsole> {
  const supabase = await createSupabaseServerClient()
  if (!supabase) throw new Error('Hosted agent console read failed')
  return readHostedAgentConsoleWithClient(supabase, ownerId, decisionAt)
}

export async function readHostedAgentConsoleWithClient(
  supabase: HostedAgentConsoleClient,
  ownerId: string,
  decisionAt: string,
): Promise<HostedAgentConsole> {
  try {
    return await readWithClient(supabase, ownerId, decisionAt)
  } catch (error) {
    const operation =
      error instanceof HostedAgentConsoleInternalError
        ? error.operation
        : 'agent_console_read'
    log('error', 'Hosted agent console read failed', {
      operation,
      errorClass: error instanceof Error ? error.name : 'UnknownThrownValue',
    })
    throw new Error('Hosted agent console read failed')
  }
}
