import { beforeEach, describe, expect, it, vi } from 'vitest'

import { initialHostedMarketMutationActionState } from './hosted-market-ingestion'

const mocks = vi.hoisted(() => ({
  createPersistence: vi.fn(),
  getContext: vi.fn(),
  getEnvironment: vi.fn(),
  persistence: { name: 'persistence' },
  provider: { name: 'provider' },
  providerConstructor: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`)
  }),
  revalidatePath: vi.fn(),
  runIngestion: vi.fn(),
  setSourceEnabled: vi.fn(),
  signOut: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@/lib/auth/hosted-owner-mutation', () => ({
  getHostedOwnerMutationContext: mocks.getContext,
}))
vi.mock('@/lib/env/server', () => ({
  getServerEnvironment: mocks.getEnvironment,
}))
vi.mock('@/lib/supabase/market-configuration-write-repository', () => ({
  writeHostedMarketConfiguration: vi.fn(),
}))
vi.mock('@/lib/supabase/market-ingestion-write-repository', () => ({
  createHostedMarketIngestionPersistence: mocks.createPersistence,
  setHostedMarketSourceEnabled: mocks.setSourceEnabled,
}))
vi.mock('@/features/markets/run-hosted-market-ingestion', () => ({
  runOwnerTriggeredAlpacaIngestion: mocks.runIngestion,
}))
vi.mock('@/providers/market-data/alpaca', () => ({
  AlpacaMarketDataProvider: class {
    constructor(options: unknown) {
      mocks.providerConstructor(options)
      return mocks.provider
    }
  },
}))

import { runHostedAlpacaIngestion, setHostedAlpacaSourceState } from './actions'

const lifecycleOperationId = 'd3000000-0000-4000-8000-000000000001'
const ingestionOperationId = 'd3000000-0000-4000-8000-000000000002'
const sourceId = 'd3000000-0000-4000-8000-000000000003'
const ingestionRunId = 'd3000000-0000-4000-8000-000000000004'

function readyContext() {
  return {
    status: 'ready' as const,
    ownerId: '00000000-0000-4000-8000-000000000001',
    supabase: { auth: { signOut: mocks.signOut } },
  }
}

function readyEnvironment() {
  return {
    MARKET_DATA_PROVIDER: 'alpaca',
    ALPACA_DATA_FEED: 'iex',
    ALPACA_API_KEY_ID: 'server-key-id',
    ALPACA_API_SECRET_KEY: 'server-secret',
    SCHEDULER_PROVIDER: 'manual',
    AGENT_ENABLED: false,
  }
}

function lifecycleForm(enabled = true) {
  const data = new FormData()
  data.set('operationId', lifecycleOperationId)
  data.set('enabled', String(enabled))
  return data
}

function ingestionForm() {
  const data = new FormData()
  data.set('operationId', ingestionOperationId)
  data.set('windowStart', '2026-08-06T12:00:00.000Z')
  data.set('windowEnd', '2026-08-07T12:00:00.000Z')
  return data
}

function completedResult(replayed = false) {
  return {
    status: replayed ? ('replayed' as const) : ('completed' as const),
    result: {
      operationId: ingestionOperationId,
      ingestionRunId,
      sourceId,
      status: 'completed' as const,
      recordsSeen: 25,
      recordsInserted: 20,
      recordsReused: 5,
      recordsRejected: 0,
      finishedAt: '2026-08-07T12:00:03.000Z',
      errorClass: null,
      replayed,
    },
  }
}

describe('hosted Alpaca mutation actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getContext.mockResolvedValue(readyContext())
    mocks.getEnvironment.mockReturnValue(readyEnvironment())
    mocks.createPersistence.mockReturnValue(mocks.persistence)
    mocks.setSourceEnabled.mockResolvedValue({
      ok: true,
      value: {
        operationId: lifecycleOperationId,
        sourceId,
        policyId: 'd3000000-0000-4000-8000-000000000005',
        policyVersion: 2,
        enabled: true,
        replayed: false,
        effectiveAt: '2026-08-07T12:00:00.000Z',
      },
    })
    mocks.runIngestion.mockResolvedValue(completedResult())
  })

  it.each([
    ['unauthenticated', '/login?reason=session-expired'],
    ['unauthorized', '/login?reason=unauthorized'],
  ] as const)('re-authorizes a %s ingestion caller', async (status, path) => {
    mocks.getContext.mockResolvedValue({
      status,
      supabase: { auth: { signOut: mocks.signOut } },
    })

    await expect(
      runHostedAlpacaIngestion(
        initialHostedMarketMutationActionState,
        ingestionForm(),
      ),
    ).rejects.toThrow(`NEXT_REDIRECT:${path}`)
    expect(mocks.runIngestion).not.toHaveBeenCalled()
    expect(mocks.signOut).toHaveBeenCalledTimes(
      status === 'unauthorized' ? 1 : 0,
    )
  })

  it('blocks source activation and provider construction outside reviewed server mode', async () => {
    mocks.getEnvironment.mockReturnValue({
      ...readyEnvironment(),
      MARKET_DATA_PROVIDER: 'mock',
    })

    await expect(
      setHostedAlpacaSourceState(
        initialHostedMarketMutationActionState,
        lifecycleForm(true),
      ),
    ).resolves.toMatchObject({ status: 'blocked' })
    await expect(
      runHostedAlpacaIngestion(
        initialHostedMarketMutationActionState,
        ingestionForm(),
      ),
    ).resolves.toMatchObject({ status: 'blocked' })

    expect(mocks.setSourceEnabled).not.toHaveBeenCalled()
    expect(mocks.providerConstructor).not.toHaveBeenCalled()
    expect(mocks.runIngestion).not.toHaveBeenCalled()
  })

  it('allows an owner to disable the source even when provider readiness is invalid', async () => {
    mocks.getEnvironment.mockImplementation(() => {
      throw new Error('invalid environment')
    })
    mocks.setSourceEnabled.mockResolvedValue({
      ok: true,
      value: {
        operationId: lifecycleOperationId,
        sourceId,
        policyId: 'd3000000-0000-4000-8000-000000000005',
        policyVersion: 3,
        enabled: false,
        replayed: false,
        effectiveAt: '2026-08-07T12:00:00.000Z',
      },
    })

    await expect(
      setHostedAlpacaSourceState(
        initialHostedMarketMutationActionState,
        lifecycleForm(false),
      ),
    ).resolves.toEqual({
      status: 'success',
      message: 'Alpaca IEX source disabled. No market data was fetched.',
    })
    expect(mocks.getEnvironment).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/markets')
  })

  it('ignores forged source, symbols, feed, and credentials', async () => {
    const data = lifecycleForm(true)
    data.set('sourceId', 'd3000000-0000-4000-8000-000000000999')
    data.set('symbols', 'GME')
    data.set('feed', 'sip')
    data.set('apiKey', 'forged-key')

    await setHostedAlpacaSourceState(
      initialHostedMarketMutationActionState,
      data,
    )

    expect(mocks.setSourceEnabled).toHaveBeenCalledWith(
      readyContext().supabase,
      { operationId: lifecycleOperationId, enabled: true },
    )
  })

  it.each([false, true])(
    'returns a confirmed ingestion summary for replayed=%s',
    async (replayed) => {
      mocks.runIngestion.mockResolvedValue(completedResult(replayed))
      const data = ingestionForm()
      data.set('symbols', 'GME')
      data.set('feed', 'sip')
      data.set('secretKey', 'forged-secret')

      await expect(
        runHostedAlpacaIngestion(initialHostedMarketMutationActionState, data),
      ).resolves.toMatchObject({
        status: replayed ? 'replayed' : 'success',
        summary: {
          recordsSeen: 25,
          recordsInserted: 20,
          recordsDeduplicated: 5,
          availableAt: '2026-08-07T12:00:03.000Z',
        },
      })
      expect(mocks.providerConstructor).toHaveBeenCalledWith({
        keyId: 'server-key-id',
        secretKey: 'server-secret',
        feed: 'iex',
      })
      expect(mocks.runIngestion).toHaveBeenCalledWith({
        request: {
          operationId: ingestionOperationId,
          windowStart: '2026-08-06T12:00:00.000Z',
          windowEnd: '2026-08-07T12:00:00.000Z',
        },
        persistence: mocks.persistence,
        provider: mocks.provider,
      })
      expect(mocks.revalidatePath).toHaveBeenCalledWith('/markets')
    },
  )

  it('maps provider failure to a safe recorded error', async () => {
    mocks.runIngestion.mockResolvedValue({
      status: 'provider-error',
      errorClass: 'raw-secret-provider-detail',
    })

    const result = await runHostedAlpacaIngestion(
      initialHostedMarketMutationActionState,
      ingestionForm(),
    )

    expect(result).toMatchObject({ status: 'provider-error' })
    expect(JSON.stringify(result)).not.toContain('raw-secret-provider-detail')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/markets')
  })

  it.each([
    ['unknown', 'unknown'],
    ['rejected', 'error'],
  ] as const)(
    'maps a %s runner outcome without a success claim',
    async (outcome, status) => {
      mocks.runIngestion.mockResolvedValue({ status: outcome })

      await expect(
        runHostedAlpacaIngestion(
          initialHostedMarketMutationActionState,
          ingestionForm(),
        ),
      ).resolves.toMatchObject({ status })
      expect(mocks.revalidatePath).not.toHaveBeenCalled()
    },
  )
})
