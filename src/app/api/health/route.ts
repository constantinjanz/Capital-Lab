import { getServerEnvironment } from '@/lib/env/server'

export const dynamic = 'force-dynamic'

export function GET() {
  const environment = getServerEnvironment()
  const controls = {
    schedulerDisabled: !environment.SCHEDULER_ENABLED,
    agentDisabled: !environment.AGENT_ENABLED,
    paidModelsDisabled: !environment.PAID_MODEL_CALLS_ENABLED,
    canaryDisabled: !environment.OPENAI_CANARY_ENABLED,
    webSearchDisabled: !environment.OPENAI_WEB_SEARCH_ENABLED,
    solChallengerDisabled:
      !environment.SOL_ENABLED && !environment.SOL_CHALLENGER_ENABLED,
    solExecutionDisabled: !environment.SOL_LIVE_EXECUTION_ENABLED,
    realBrokerDisabled: !environment.REAL_BROKER_ENABLED,
  }
  const mockPaperOnly =
    environment.MARKET_DATA_PROVIDER === 'mock' &&
    environment.NEWS_PROVIDER === 'mock' &&
    environment.AGENT_EXECUTION_MODE === 'mock' &&
    !environment.AUTONOMOUS_PAPER_EXECUTION_ENABLED
  const activationSafe = Object.values(controls).every(Boolean) && mockPaperOnly
  return Response.json(
    {
      status: activationSafe ? 'ok' : 'restricted',
      application: 'capital-lab',
      paperTradingOnly: true,
      activationSafe,
      controls,
      dataMode: mockPaperOnly ? 'mock-paper-only' : 'restricted-non-mock',
      timestamp: new Date().toISOString(),
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  )
}
