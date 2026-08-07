import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
  maybeSingle: vi.fn(),
  eq: vi.fn(),
  select: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/lib/auth/supabase/server', () => ({
  createSupabaseServerClient: mocks.createClient,
}))

import { getHostedOwnerMutationContext } from './hosted-owner-mutation'

const userId = '00000000-0000-4000-8000-000000000001'

function client() {
  const query = {
    select: mocks.select,
    eq: mocks.eq,
    maybeSingle: mocks.maybeSingle,
  }
  mocks.from.mockReturnValue(query)
  mocks.select.mockReturnValue(query)
  mocks.eq.mockReturnValue(query)
  return {
    auth: { getUser: mocks.getUser },
    from: mocks.from,
  }
}

describe('getHostedOwnerMutationContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects unconfigured mock mode', async () => {
    mocks.createClient.mockResolvedValue(null)

    await expect(getHostedOwnerMutationContext()).resolves.toEqual({
      status: 'unconfigured',
    })
    expect(mocks.getUser).not.toHaveBeenCalled()
  })

  it('uses a fresh Auth user check and rejects an expired session', async () => {
    const supabase = client()
    mocks.createClient.mockResolvedValue(supabase)
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: new Error('expired'),
    })

    await expect(getHostedOwnerMutationContext()).resolves.toMatchObject({
      status: 'unauthenticated',
      supabase,
    })
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('requires the exact active owner row', async () => {
    const supabase = client()
    mocks.createClient.mockResolvedValue(supabase)
    mocks.getUser.mockResolvedValue({ data: { user: { id: userId } } })
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null })

    await expect(getHostedOwnerMutationContext()).resolves.toMatchObject({
      status: 'unauthorized',
      supabase,
    })
    expect(mocks.from).toHaveBeenCalledWith('app_users')
    expect(mocks.eq.mock.calls).toEqual([
      ['user_id', userId],
      ['role', 'owner'],
      ['is_active', true],
    ])
  })

  it('distinguishes a database verification failure', async () => {
    const supabase = client()
    mocks.createClient.mockResolvedValue(supabase)
    mocks.getUser.mockResolvedValue({ data: { user: { id: userId } } })
    mocks.maybeSingle.mockResolvedValue({
      data: null,
      error: new Error('database unavailable'),
    })

    await expect(getHostedOwnerMutationContext()).resolves.toMatchObject({
      status: 'unavailable',
      supabase,
    })
  })

  it('returns the same session-bound client for the verified owner', async () => {
    const supabase = client()
    mocks.createClient.mockResolvedValue(supabase)
    mocks.getUser.mockResolvedValue({ data: { user: { id: userId } } })
    mocks.maybeSingle.mockResolvedValue({
      data: { user_id: userId },
      error: null,
    })

    await expect(getHostedOwnerMutationContext()).resolves.toEqual({
      status: 'ready',
      ownerId: userId,
      supabase,
    })
  })
})
