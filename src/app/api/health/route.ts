import { getServerEnvironment } from '@/lib/env/server'

export const dynamic = 'force-dynamic'

export function GET() {
  const environment = getServerEnvironment()
  return Response.json(
    {
      status: 'ok',
      application: 'capital-lab',
      paperTradingOnly: true,
      dataMode: environment.MARKET_DATA_PROVIDER,
      agentEnabled: environment.AGENT_ENABLED,
      timestamp: new Date().toISOString(),
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  )
}
