import { getServerEnvironment } from '@/lib/env/server'
import { log } from '@/lib/logging/logger'
import { runMockSafeMarketCycle } from '@/features/scheduler/market-cycle'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
  const environment = getServerEnvironment()
  if (
    !environment.CRON_SECRET ||
    request.headers.get('authorization') !== `Bearer ${environment.CRON_SECRET}`
  ) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (environment.SCHEDULER_PROVIDER !== 'vercel') {
    return Response.json({
      status: 'skipped',
      reason: 'scheduler_provider_not_vercel',
    })
  }

  const correlationId = crypto.randomUUID()
  try {
    const result = await runMockSafeMarketCycle(new Date())
    log('info', 'Market cycle completed', {
      correlationId,
      operation: 'market_cycle',
      metadata: {
        status: result.status,
        modelCalls: result.modelCalls,
        paperOrders: result.paperOrdersCreated,
      },
    })
    return Response.json({ correlationId, ...result })
  } catch (error) {
    log('error', 'Market cycle failed safely', {
      correlationId,
      operation: 'market_cycle',
      errorClass: error instanceof Error ? error.name : 'UnknownError',
    })
    return Response.json(
      { correlationId, status: 'failed', paperOrdersCreated: 0 },
      { status: 503 },
    )
  }
}
