import { getOwnerIdentity } from '@/lib/auth/require-owner'
import { getServerEnvironment } from '@/lib/env/server'
import { consumeRateLimit } from '@/lib/security/rate-limit'
import { runMockSafeMarketCycle } from '@/features/scheduler/market-cycle'

export async function POST() {
  const owner = await getOwnerIdentity()
  if (!owner) return Response.json({ error: 'unauthorized' }, { status: 401 })
  if (owner.mode === 'supabase') {
    return Response.json(
      { error: 'hosted_market_cycle_not_implemented' },
      { status: 409 },
    )
  }

  const environment = getServerEnvironment()
  if (environment.SCHEDULER_PROVIDER !== 'manual') {
    return Response.json(
      { error: 'manual scheduler is not active' },
      { status: 409 },
    )
  }
  const rateLimit = consumeRateLimit(`manual-cycle:${owner.id}`, {
    limit: 4,
    windowMs: 60_000,
  })
  if (!rateLimit.allowed) {
    return Response.json(
      { error: 'rate_limited' },
      {
        status: 429,
        headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) },
      },
    )
  }
  return Response.json(await runMockSafeMarketCycle(new Date()))
}
