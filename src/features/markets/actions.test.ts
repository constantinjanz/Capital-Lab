import { beforeEach, describe, expect, it, vi } from 'vitest'

import { initialHostedMarketConfigurationActionState } from './configure-hosted-market'
import { initialHostedOfficialCalendarConfigurationActionState } from './hosted-official-calendar'

const mocks = vi.hoisted(() => ({
  getContext: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`)
  }),
  revalidatePath: vi.fn(),
  signOut: vi.fn(),
  writeCalendar: vi.fn(),
  writeConfiguration: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@/lib/auth/hosted-owner-mutation', () => ({
  getHostedOwnerMutationContext: mocks.getContext,
}))
vi.mock('@/lib/supabase/market-configuration-write-repository', () => ({
  writeHostedMarketConfiguration: mocks.writeConfiguration,
}))
vi.mock('@/lib/supabase/official-calendar-write-repository', () => ({
  writeHostedOfficialCalendarConfiguration: mocks.writeCalendar,
}))

import {
  configureHostedMarketManifest,
  configureHostedOfficialCalendarManifest,
} from './actions'

const operationId = 'd3000000-0000-4000-8000-000000000001'

function form() {
  const data = new FormData()
  data.set('operationId', operationId)
  return data
}

function readyContext() {
  return {
    status: 'ready' as const,
    ownerId: '00000000-0000-4000-8000-000000000001',
    supabase: { auth: { signOut: mocks.signOut } },
  }
}

function successfulResult(replayed = false) {
  return {
    ok: true,
    operationId,
    universeId: 'a3000000-0000-4000-8000-000000000001',
    sourceId: 'b3000000-0000-4000-8000-000000000001',
    replayed,
  }
}

describe('configureHostedMarketManifest action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getContext.mockResolvedValue(readyContext())
    mocks.writeConfiguration.mockResolvedValue(successfulResult())
  })

  it('fails closed in local mock mode', async () => {
    mocks.getContext.mockResolvedValue({ status: 'unconfigured' })

    await expect(
      configureHostedMarketManifest(
        initialHostedMarketConfigurationActionState,
        form(),
      ),
    ).resolves.toEqual({
      status: 'error',
      message: 'Hosted market configuration is unavailable in local mock mode.',
    })
    expect(mocks.writeConfiguration).not.toHaveBeenCalled()
  })

  it.each([
    ['unauthenticated', '/login?reason=session-expired'],
    ['unauthorized', '/login?reason=unauthorized'],
  ] as const)(
    're-authorizes and redirects a %s caller',
    async (status, path) => {
      mocks.getContext.mockResolvedValue({
        status,
        supabase: { auth: { signOut: mocks.signOut } },
      })

      await expect(
        configureHostedMarketManifest(
          initialHostedMarketConfigurationActionState,
          form(),
        ),
      ).rejects.toThrow(`NEXT_REDIRECT:${path}`)
      expect(mocks.writeConfiguration).not.toHaveBeenCalled()
      expect(mocks.signOut).toHaveBeenCalledTimes(
        status === 'unauthorized' ? 1 : 0,
      )
    },
  )

  it('returns a safe error when owner verification is unavailable', async () => {
    mocks.getContext.mockResolvedValue({
      status: 'unavailable',
      supabase: { auth: { signOut: mocks.signOut } },
    })

    await expect(
      configureHostedMarketManifest(
        initialHostedMarketConfigurationActionState,
        form(),
      ),
    ).resolves.toEqual({
      status: 'error',
      message: 'Owner verification is temporarily unavailable. Try again.',
    })
    expect(mocks.writeConfiguration).not.toHaveBeenCalled()
  })

  it('rejects an invalid operation before the repository call', async () => {
    const data = form()
    data.set('operationId', 'not-a-uuid')

    await expect(
      configureHostedMarketManifest(
        initialHostedMarketConfigurationActionState,
        data,
      ),
    ).resolves.toMatchObject({
      status: 'error',
      fieldErrors: { operationId: expect.any(String) },
    })
    expect(mocks.writeConfiguration).not.toHaveBeenCalled()
  })

  it('ignores forged owner, universe, source, credential, and enablement fields', async () => {
    const data = form()
    data.set('ownerId', '00000000-0000-4000-8000-000000000999')
    data.set('universeName', 'Forged universe')
    data.set('symbols', 'GME')
    data.set('sourceUrl', 'https://example.invalid')
    data.set('sourceEnabled', 'true')
    data.set('apiKey', 'must-be-ignored')

    await configureHostedMarketManifest(
      initialHostedMarketConfigurationActionState,
      data,
    )

    expect(mocks.writeConfiguration).toHaveBeenCalledWith(
      readyContext().supabase,
      { operationId },
    )
  })

  it.each([
    [
      false,
      'Reviewed configuration saved. No data was fetched, no credentials were added, and no activation state changed.',
    ],
    [
      true,
      'This reviewed configuration was already saved. No data was fetched and no activation state changed.',
    ],
  ] as const)(
    'returns a safe success state for replayed=%s',
    async (replayed, message) => {
      mocks.writeConfiguration.mockResolvedValue(successfulResult(replayed))

      await expect(
        configureHostedMarketManifest(
          initialHostedMarketConfigurationActionState,
          form(),
        ),
      ).resolves.toEqual({ status: 'success', message })
      expect(mocks.revalidatePath).toHaveBeenCalledWith('/markets')
    },
  )

  it('maps a definite rejection without leaking raw database detail', async () => {
    mocks.writeConfiguration.mockResolvedValue({
      ok: false,
      reason: 'rejected',
      raw: 'must never reach the action state',
    })

    const result = await configureHostedMarketManifest(
      initialHostedMarketConfigurationActionState,
      form(),
    )

    expect(result).toEqual({
      status: 'error',
      message:
        'The reviewed configuration was rejected. No partial market configuration was accepted.',
    })
    expect(JSON.stringify(result)).not.toContain('must never reach')
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it.each([
    [
      'returned',
      () =>
        mocks.writeConfiguration.mockResolvedValue({
          ok: false,
          reason: 'unknown',
        }),
    ],
    [
      'thrown',
      () =>
        mocks.writeConfiguration.mockRejectedValue(
          new Error('raw transport detail'),
        ),
    ],
  ] as const)(
    'returns a retry-safe unknown state for a %s outcome',
    async (_label, arrange) => {
      arrange()

      const result = await configureHostedMarketManifest(
        initialHostedMarketConfigurationActionState,
        form(),
      )

      expect(result).toEqual({
        status: 'unknown',
        message:
          'The configuration result could not be confirmed. Retry this same setup or reload Markets before continuing.',
      })
      expect(JSON.stringify(result)).not.toContain('raw transport detail')
      expect(mocks.revalidatePath).not.toHaveBeenCalled()
    },
  )
})

describe('configureHostedOfficialCalendarManifest action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getContext.mockResolvedValue(readyContext())
    mocks.writeCalendar.mockResolvedValue({
      ok: true,
      operationId,
      manifestRecordId: 'e3000000-0000-4000-8000-000000000001',
      sourceCount: 2,
      sessionCount: 522,
      replayed: false,
    })
  })

  it('re-authorizes and fails closed outside hosted owner mode', async () => {
    mocks.getContext.mockResolvedValue({ status: 'unconfigured' })

    await expect(
      configureHostedOfficialCalendarManifest(
        initialHostedOfficialCalendarConfigurationActionState,
        form(),
      ),
    ).resolves.toEqual({
      status: 'error',
      message: 'Official calendar setup is unavailable in local mock mode.',
    })
    expect(mocks.writeCalendar).not.toHaveBeenCalled()
  })

  it('accepts only the operation id and ignores forged manifest/runtime fields', async () => {
    const data = form()
    data.set('ownerId', '00000000-0000-4000-8000-000000000999')
    data.set('calendarYear', '2030')
    data.set('sourceUrl', 'https://example.invalid')
    data.set('schedulerEnabled', 'true')

    await configureHostedOfficialCalendarManifest(
      initialHostedOfficialCalendarConfigurationActionState,
      data,
    )

    expect(mocks.writeCalendar).toHaveBeenCalledWith(readyContext().supabase, {
      operationId,
    })
  })

  it('rejects an invalid operation before persistence', async () => {
    const data = form()
    data.set('operationId', 'invalid')

    await expect(
      configureHostedOfficialCalendarManifest(
        initialHostedOfficialCalendarConfigurationActionState,
        data,
      ),
    ).resolves.toMatchObject({
      status: 'error',
      fieldErrors: { operationId: expect.any(String) },
    })
    expect(mocks.writeCalendar).not.toHaveBeenCalled()
  })

  it.each([
    [
      false,
      'Reviewed 2026 XNAS/ARCX calendar saved. No provider request was made and scheduling remains disabled.',
    ],
    [
      true,
      'This reviewed 2026 calendar was already saved. No provider or scheduler state changed.',
    ],
  ] as const)(
    'returns a safe success for replayed=%s',
    async (replayed, message) => {
      mocks.writeCalendar.mockResolvedValue({
        ok: true,
        operationId,
        manifestRecordId: 'e3000000-0000-4000-8000-000000000001',
        sourceCount: 2,
        sessionCount: 522,
        replayed,
      })

      await expect(
        configureHostedOfficialCalendarManifest(
          initialHostedOfficialCalendarConfigurationActionState,
          form(),
        ),
      ).resolves.toEqual({ status: 'success', message })
      expect(mocks.revalidatePath).toHaveBeenCalledWith('/markets')
    },
  )

  it.each([
    [
      { ok: false, reason: 'rejected' },
      {
        status: 'error',
        message:
          'The reviewed official calendar was rejected. No partial calendar configuration was accepted.',
      },
    ],
    [
      { ok: false, reason: 'unknown' },
      {
        status: 'unknown',
        message:
          'The calendar setup result could not be confirmed. Retry this same setup or reload Markets before continuing.',
      },
    ],
  ] as const)(
    'maps a safe %s failure state',
    async (repositoryResult, expected) => {
      mocks.writeCalendar.mockResolvedValue(repositoryResult)

      const result = await configureHostedOfficialCalendarManifest(
        initialHostedOfficialCalendarConfigurationActionState,
        form(),
      )

      expect(result).toEqual(expected)
      expect(mocks.revalidatePath).not.toHaveBeenCalled()
    },
  )
})
