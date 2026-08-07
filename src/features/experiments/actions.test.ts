import { beforeEach, describe, expect, it, vi } from 'vitest'

import { initialHostedDraftActionState } from './create-hosted-draft'

const mocks = vi.hoisted(() => ({
  createDraft: vi.fn(),
  getContext: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`)
  }),
  revalidatePath: vi.fn(),
  signOut: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@/lib/auth/hosted-owner-mutation', () => ({
  getHostedOwnerMutationContext: mocks.getContext,
}))
vi.mock('@/lib/supabase/experiment-write-repository', () => ({
  createHostedDraftExperiment: mocks.createDraft,
}))

import { createHostedDraftExperiment } from './actions'

const operationId = 'd1000000-0000-4000-8000-000000000001'
const experimentId = 'e1000000-0000-4000-8000-000000000001'

function validForm() {
  const data = new FormData()
  data.set('operationId', operationId)
  data.set('name', ' Hosted event study ')
  data.set('objective', ' Evaluate a point-in-time event hypothesis safely. ')
  return data
}

function readyContext() {
  return {
    status: 'ready' as const,
    ownerId: '00000000-0000-4000-8000-000000000001',
    supabase: { auth: { signOut: mocks.signOut } },
  }
}

describe('createHostedDraftExperiment action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getContext.mockResolvedValue(readyContext())
    mocks.createDraft.mockResolvedValue({ ok: true, experimentId })
  })

  it('fails closed when hosted Supabase is not configured', async () => {
    mocks.getContext.mockResolvedValue({ status: 'unconfigured' })

    await expect(
      createHostedDraftExperiment(initialHostedDraftActionState, validForm()),
    ).resolves.toEqual({
      status: 'error',
      message: 'Hosted draft creation is unavailable in local mock mode.',
    })
    expect(mocks.createDraft).not.toHaveBeenCalled()
  })

  it.each([
    ['unauthenticated', '/login?reason=session-expired'],
    ['unauthorized', '/login?reason=unauthorized'],
  ] as const)('redirects a %s caller', async (status, destination) => {
    mocks.getContext.mockResolvedValue({
      status,
      supabase: { auth: { signOut: mocks.signOut } },
    })

    await expect(
      createHostedDraftExperiment(initialHostedDraftActionState, validForm()),
    ).rejects.toThrow(`NEXT_REDIRECT:${destination}`)
    expect(mocks.redirect).toHaveBeenCalledWith(destination)
    expect(mocks.createDraft).not.toHaveBeenCalled()
    expect(mocks.signOut).toHaveBeenCalledTimes(
      status === 'unauthorized' ? 1 : 0,
    )
  })

  it('returns a safe error when owner verification is unavailable', async () => {
    mocks.getContext.mockResolvedValue({
      status: 'unavailable',
      supabase: { auth: { signOut: mocks.signOut } },
    })

    await expect(
      createHostedDraftExperiment(initialHostedDraftActionState, validForm()),
    ).resolves.toMatchObject({ status: 'error' })
    expect(mocks.createDraft).not.toHaveBeenCalled()
  })

  it('returns field errors without calling the write repository', async () => {
    const data = validForm()
    data.set('name', 'x')

    const result = await createHostedDraftExperiment(
      initialHostedDraftActionState,
      data,
    )

    expect(result.fieldErrors?.name).toBeTruthy()
    expect(mocks.createDraft).not.toHaveBeenCalled()
  })

  it('ignores forged ownership and lifecycle fields', async () => {
    const data = validForm()
    data.set('ownerId', '00000000-0000-4000-8000-000000000999')
    data.set('lifecycleStatus', 'active')
    data.set('schedulerEnabled', 'true')

    await expect(
      createHostedDraftExperiment(initialHostedDraftActionState, data),
    ).rejects.toThrow(`NEXT_REDIRECT:/experiments/${experimentId}`)
    expect(mocks.createDraft).toHaveBeenCalledWith(readyContext().supabase, {
      operationId,
      name: 'Hosted event study',
      objective: 'Evaluate a point-in-time event hypothesis safely.',
    })
  })

  it('sanitizes an RPC failure and does not redirect', async () => {
    mocks.createDraft.mockResolvedValue({ ok: false })

    await expect(
      createHostedDraftExperiment(initialHostedDraftActionState, validForm()),
    ).resolves.toEqual({
      status: 'error',
      message:
        'The hosted draft could not be created. No partial draft was saved.',
    })
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('sanitizes an unexpected transport failure and does not redirect', async () => {
    mocks.createDraft.mockRejectedValue(new Error('connection reset'))

    await expect(
      createHostedDraftExperiment(initialHostedDraftActionState, validForm()),
    ).resolves.toEqual({
      status: 'error',
      message:
        'The hosted draft could not be created. No partial draft was saved.',
    })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('revalidates affected reads before redirecting to persisted detail', async () => {
    await expect(
      createHostedDraftExperiment(initialHostedDraftActionState, validForm()),
    ).rejects.toThrow(`NEXT_REDIRECT:/experiments/${experimentId}`)

    expect(mocks.revalidatePath.mock.calls).toEqual([
      ['/experiments'],
      ['/dashboard'],
      [`/experiments/${experimentId}`],
    ])
    expect(mocks.redirect).toHaveBeenCalledWith(`/experiments/${experimentId}`)
  })
})
