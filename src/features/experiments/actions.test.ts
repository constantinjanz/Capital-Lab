import { beforeEach, describe, expect, it, vi } from 'vitest'

import { initialHostedDraftActionState } from './create-hosted-draft'
import { initialHostedLifecycleActionState } from './mutate-hosted-lifecycle'
import { initialHostedDraftUpdateActionState } from './update-hosted-draft'

const mocks = vi.hoisted(() => ({
  createDraft: vi.fn(),
  mutateLifecycle: vi.fn(),
  updateDraft: vi.fn(),
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
  mutateHostedLockedExperimentLifecycle: mocks.mutateLifecycle,
  updateHostedDraftExperiment: mocks.updateDraft,
}))

import {
  createHostedDraftExperiment,
  mutateHostedLockedExperimentLifecycle,
  updateHostedDraftExperiment,
} from './actions'

const operationId = 'd1000000-0000-4000-8000-000000000001'
const experimentId = 'e1000000-0000-4000-8000-000000000001'

function validForm() {
  const data = new FormData()
  data.set('operationId', operationId)
  data.set('name', ' Hosted event study ')
  data.set('objective', ' Evaluate a point-in-time event hypothesis safely. ')
  return data
}

function validUpdateForm() {
  const data = new FormData()
  data.set('operationId', 'd2000000-0000-4000-8000-000000000001')
  data.set('experimentId', experimentId)
  data.set('expectedRevision', '9007199254740993')
  data.set('name', ' Revised hosted event study ')
  data.set(
    'objective',
    ' Evaluate a revised point-in-time event hypothesis safely. ',
  )
  return data
}

function validLifecycleForm(action = 'pause') {
  const data = new FormData()
  data.set('operationId', 'd3000000-0000-4000-8000-000000000001')
  data.set('experimentId', experimentId)
  data.set('expectedControlStateVersion', '9007199254740993')
  data.set('action', action)
  if (action === 'pause') data.set('reason', ' Owner review ')
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

describe('updateHostedDraftExperiment action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getContext.mockResolvedValue(readyContext())
    mocks.updateDraft.mockResolvedValue({ ok: true, experimentId })
  })

  it('fails closed when hosted Supabase is not configured', async () => {
    mocks.getContext.mockResolvedValue({ status: 'unconfigured' })

    await expect(
      updateHostedDraftExperiment(
        initialHostedDraftUpdateActionState,
        validUpdateForm(),
      ),
    ).resolves.toEqual({
      status: 'error',
      message: 'Hosted draft editing is unavailable in local mock mode.',
    })
    expect(mocks.updateDraft).not.toHaveBeenCalled()
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
      updateHostedDraftExperiment(
        initialHostedDraftUpdateActionState,
        validUpdateForm(),
      ),
    ).rejects.toThrow(`NEXT_REDIRECT:${destination}`)
    expect(mocks.redirect).toHaveBeenCalledWith(destination)
    expect(mocks.updateDraft).not.toHaveBeenCalled()
    expect(mocks.signOut).toHaveBeenCalledTimes(
      status === 'unauthorized' ? 1 : 0,
    )
  })

  it('preserves the exact revision string and ignores forged state fields', async () => {
    const data = validUpdateForm()
    data.set('ownerId', '00000000-0000-4000-8000-000000000999')
    data.set('initialCapital', '1')
    data.set('lifecycleStatus', 'active')
    data.set('schedulerEnabled', 'true')

    await expect(
      updateHostedDraftExperiment(initialHostedDraftUpdateActionState, data),
    ).rejects.toThrow(`NEXT_REDIRECT:/experiments/${experimentId}`)
    expect(mocks.updateDraft).toHaveBeenCalledWith(readyContext().supabase, {
      operationId: 'd2000000-0000-4000-8000-000000000001',
      experimentId,
      expectedRevision: '9007199254740993',
      name: 'Revised hosted event study',
      objective: 'Evaluate a revised point-in-time event hypothesis safely.',
    })
  })

  it('returns field errors without calling the write repository', async () => {
    const data = validUpdateForm()
    data.set('expectedRevision', '01')

    const result = await updateHostedDraftExperiment(
      initialHostedDraftUpdateActionState,
      data,
    )

    expect(result.fieldErrors?.expectedRevision).toBeTruthy()
    expect(mocks.updateDraft).not.toHaveBeenCalled()
  })

  it.each([
    ['conflict', 'This draft changed. Reload the page before saving again.'],
    ['invalid', 'Change the draft name or objective before saving.'],
    [
      'rejected',
      'The hosted draft could not be saved. No partial change was made.',
    ],
    [
      'unknown',
      'The save result could not be confirmed. Reload this page before making another change.',
    ],
  ] as const)('maps %s failures to a safe message', async (reason, message) => {
    mocks.updateDraft.mockResolvedValue({ ok: false, reason })

    await expect(
      updateHostedDraftExperiment(
        initialHostedDraftUpdateActionState,
        validUpdateForm(),
      ),
    ).resolves.toEqual({
      status: reason === 'unknown' ? 'unknown' : 'error',
      message,
    })
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('sanitizes an unexpected transport failure', async () => {
    mocks.updateDraft.mockRejectedValue(new Error('connection reset'))

    await expect(
      updateHostedDraftExperiment(
        initialHostedDraftUpdateActionState,
        validUpdateForm(),
      ),
    ).resolves.toEqual({
      status: 'unknown',
      message:
        'The save result could not be confirmed. Reload this page before making another change.',
    })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('revalidates affected reads before redirecting to fresh detail', async () => {
    await expect(
      updateHostedDraftExperiment(
        initialHostedDraftUpdateActionState,
        validUpdateForm(),
      ),
    ).rejects.toThrow(`NEXT_REDIRECT:/experiments/${experimentId}`)

    expect(mocks.revalidatePath.mock.calls).toEqual([
      ['/experiments'],
      ['/dashboard'],
      [`/experiments/${experimentId}`],
    ])
    expect(mocks.redirect).toHaveBeenCalledWith(`/experiments/${experimentId}`)
  })
})

describe('mutateHostedLockedExperimentLifecycle action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getContext.mockResolvedValue(readyContext())
    mocks.mutateLifecycle.mockResolvedValue({
      ok: true,
      result: {
        experimentId,
        sourceExperimentId: null,
        lifecycleStatus: 'paused',
        executionMode: 'shadow',
        controlStateVersion: '9007199254740994',
        replayed: false,
      },
    })
  })

  it('reauthorizes and forwards only strict lifecycle fields', async () => {
    const data = validLifecycleForm()
    data.set('ownerId', '00000000-0000-4000-8000-000000000999')
    data.set('schedulerEnabled', 'true')
    data.set('agentEnabled', 'true')
    data.set('executionMode', 'broker')

    await expect(
      mutateHostedLockedExperimentLifecycle(
        initialHostedLifecycleActionState,
        data,
      ),
    ).rejects.toThrow(`NEXT_REDIRECT:/experiments/${experimentId}`)
    expect(mocks.mutateLifecycle).toHaveBeenCalledWith(
      readyContext().supabase,
      {
        operationId: 'd3000000-0000-4000-8000-000000000001',
        experimentId,
        expectedControlStateVersion: '9007199254740993',
        action: 'pause',
        reason: 'Owner review',
        confirmation: null,
        lockedVersionId: null,
        cloneName: null,
      },
    )
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
      mutateHostedLockedExperimentLifecycle(
        initialHostedLifecycleActionState,
        validLifecycleForm(),
      ),
    ).rejects.toThrow(`NEXT_REDIRECT:${destination}`)
    expect(mocks.mutateLifecycle).not.toHaveBeenCalled()
    expect(mocks.signOut).toHaveBeenCalledTimes(
      status === 'unauthorized' ? 1 : 0,
    )
  })

  it('returns validation errors before reaching the repository', async () => {
    const data = validLifecycleForm('promote_live_paper')
    data.set('confirmation', 'yes')

    const result = await mutateHostedLockedExperimentLifecycle(
      initialHostedLifecycleActionState,
      data,
    )

    expect(result.fieldErrors?.confirmation).toBe(
      'Enter PROMOTE TO LIVE PAPER exactly',
    )
    expect(mocks.mutateLifecycle).not.toHaveBeenCalled()
  })

  it.each([
    ['conflict', 'This experiment changed. Reload before trying again.'],
    ['invalid', 'Review the lifecycle action and confirmation fields.'],
    [
      'transition',
      'This lifecycle change is not currently allowed. Reload and review the experiment state.',
    ],
    [
      'rejected',
      'The lifecycle change was rejected. No partial change was made.',
    ],
    [
      'unknown',
      'The lifecycle result could not be confirmed. Reload this page before trying another action.',
    ],
  ] as const)('maps %s failures to a safe message', async (reason, message) => {
    mocks.mutateLifecycle.mockResolvedValue({ ok: false, reason })

    await expect(
      mutateHostedLockedExperimentLifecycle(
        initialHostedLifecycleActionState,
        validLifecycleForm(),
      ),
    ).resolves.toEqual({
      status: reason === 'unknown' ? 'unknown' : 'error',
      message,
    })
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('redirects a clone to its new persisted draft', async () => {
    const cloneId = 'e1000000-0000-4000-8000-000000000002'
    const data = validLifecycleForm('clone')
    data.set('cloneName', 'Next paper draft')
    mocks.mutateLifecycle.mockResolvedValue({
      ok: true,
      result: {
        experimentId: cloneId,
        sourceExperimentId: experimentId,
        lifecycleStatus: 'draft',
        executionMode: null,
        controlStateVersion: '0',
        replayed: false,
      },
    })

    await expect(
      mutateHostedLockedExperimentLifecycle(
        initialHostedLifecycleActionState,
        data,
      ),
    ).rejects.toThrow(`NEXT_REDIRECT:/experiments/${cloneId}`)
    expect(mocks.revalidatePath.mock.calls).toEqual([
      ['/experiments'],
      ['/dashboard'],
      [`/experiments/${experimentId}`],
      [`/experiments/${cloneId}`],
    ])
  })
})
