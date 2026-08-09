import { randomUUID } from 'node:crypto'

import type { PaidCanaryBudgetLedger } from '../src/features/agent/paid-canary'
import { runPaidOpenAICanary } from '../src/features/agent/paid-canary'
import { getServerEnvironment } from '../src/lib/env/server'
import { createSupabaseAdminClient } from '../src/lib/supabase/admin'
import {
  claimPaidCanary,
  createPaidCanaryBudgetLedger,
  loadPaidCanaryContext,
  type CanaryContext,
} from '../src/lib/supabase/paid-canary-repository'
import { createOpenAIGateway } from '../src/providers/openai/factory'

const confirmation = process.argv
  .find((argument) => argument.startsWith('--confirm-paid-canary='))
  ?.slice('--confirm-paid-canary='.length)
const operationId =
  process.argv
    .find((argument) => argument.startsWith('--operation-id='))
    ?.slice('--operation-id='.length) ?? randomUUID()
const environment = getServerEnvironment()
const requestedAt = new Date().toISOString()
const client = createSupabaseAdminClient()

let context: CanaryContext | undefined
let ledger: PaidCanaryBudgetLedger | undefined
async function initialize() {
  if (!client) throw new Error('Paid Canary database client is unavailable')
  context ??= await loadPaidCanaryContext(client, requestedAt)
  ledger ??= createPaidCanaryBudgetLedger({ client, context, requestedAt })
  return { client, context, ledger }
}

const lazyLedger: PaidCanaryBudgetLedger = {
  async reserve(input) {
    return (await initialize()).ledger.reserve(input)
  },
  async settle(reservationId, result) {
    return (await initialize()).ledger.settle(reservationId, result)
  },
  async markUnknown(reservationId) {
    return (await initialize()).ledger.markUnknown(reservationId)
  },
  async release(reservationId) {
    return (await initialize()).ledger.release(reservationId)
  },
}

const outcome = await runPaidOpenAICanary({
  confirmation,
  operationId,
  configuration: {
    agentEnabled: environment.AGENT_ENABLED,
    autonomousPaperExecutionEnabled:
      environment.AUTONOMOUS_PAPER_EXECUTION_ENABLED,
    paidModelCallsEnabled: environment.PAID_MODEL_CALLS_ENABLED,
    canaryEnabled: environment.OPENAI_CANARY_ENABLED,
    webSearchEnabled: environment.OPENAI_WEB_SEARCH_ENABLED,
    previewLike:
      process.env.VERCEL_ENV !== undefined &&
      process.env.VERCEL_ENV !== 'production',
  },
  gateway: createOpenAIGateway('canary'),
  ledger: lazyLedger,
  async acquireOneShotLock(id) {
    const initialized = await initialize()
    return claimPaidCanary(initialized.client, initialized.context.ownerId, id)
  },
})

process.stdout.write(
  `${JSON.stringify({ operationId, ...outcome }, null, 2)}\n`,
)
process.exitCode = outcome.status === 'completed' ? 0 : 1
