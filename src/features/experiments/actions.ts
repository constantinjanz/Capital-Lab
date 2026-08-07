'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import {
  type HostedDraftActionState,
  parseHostedDraftForm,
} from '@/features/experiments/create-hosted-draft'
import {
  type HostedLifecycleActionState,
  parseHostedLifecycleForm,
} from '@/features/experiments/mutate-hosted-lifecycle'
import {
  type HostedDraftUpdateActionState,
  parseHostedDraftUpdateForm,
} from '@/features/experiments/update-hosted-draft'
import { getHostedOwnerMutationContext } from '@/lib/auth/hosted-owner-mutation'
import {
  createHostedDraftExperiment as createHostedDraft,
  mutateHostedLockedExperimentLifecycle as mutateHostedLifecycle,
  updateHostedDraftExperiment as updateHostedDraft,
} from '@/lib/supabase/experiment-write-repository'

const UNKNOWN_DRAFT_UPDATE_MESSAGE =
  'The save result could not be confirmed. Reload this page before making another change.'
const UNKNOWN_LIFECYCLE_MESSAGE =
  'The lifecycle result could not be confirmed. Reload this page before trying another action.'

export async function createHostedDraftExperiment(
  _previousState: HostedDraftActionState,
  formData: FormData,
): Promise<HostedDraftActionState> {
  const context = await getHostedOwnerMutationContext()

  if (context.status === 'unconfigured') {
    return {
      status: 'error',
      message: 'Hosted draft creation is unavailable in local mock mode.',
    }
  }
  if (context.status === 'unauthenticated') {
    redirect('/login?reason=session-expired')
  }
  if (context.status === 'unauthorized') {
    await context.supabase.auth.signOut()
    redirect('/login?reason=unauthorized')
  }
  if (context.status === 'unavailable') {
    return {
      status: 'error',
      message: 'Owner verification is temporarily unavailable. Try again.',
    }
  }

  const parsed = parseHostedDraftForm(formData)
  if (!parsed.success) return parsed.state

  let result: Awaited<ReturnType<typeof createHostedDraft>>
  try {
    result = await createHostedDraft(context.supabase, parsed.data)
  } catch {
    return {
      status: 'error',
      message:
        'The hosted draft could not be created. No partial draft was saved.',
    }
  }

  if (!result.ok) {
    return {
      status: 'error',
      message:
        'The hosted draft could not be created. No partial draft was saved.',
    }
  }

  revalidatePath('/experiments')
  revalidatePath('/dashboard')
  revalidatePath(`/experiments/${result.experimentId}`)
  redirect(`/experiments/${result.experimentId}`)
}

export async function updateHostedDraftExperiment(
  _previousState: HostedDraftUpdateActionState,
  formData: FormData,
): Promise<HostedDraftUpdateActionState> {
  const context = await getHostedOwnerMutationContext()

  if (context.status === 'unconfigured') {
    return {
      status: 'error',
      message: 'Hosted draft editing is unavailable in local mock mode.',
    }
  }
  if (context.status === 'unauthenticated') {
    redirect('/login?reason=session-expired')
  }
  if (context.status === 'unauthorized') {
    await context.supabase.auth.signOut()
    redirect('/login?reason=unauthorized')
  }
  if (context.status === 'unavailable') {
    return {
      status: 'error',
      message: 'Owner verification is temporarily unavailable. Try again.',
    }
  }

  const parsed = parseHostedDraftUpdateForm(formData)
  if (!parsed.success) return parsed.state

  let result: Awaited<ReturnType<typeof updateHostedDraft>>
  try {
    result = await updateHostedDraft(context.supabase, parsed.data)
  } catch {
    return {
      status: 'unknown',
      message: UNKNOWN_DRAFT_UPDATE_MESSAGE,
    }
  }

  if (!result.ok) {
    if (result.reason === 'conflict') {
      return {
        status: 'error',
        message: 'This draft changed. Reload the page before saving again.',
      }
    }
    if (result.reason === 'invalid') {
      return {
        status: 'error',
        message: 'Change the draft name or objective before saving.',
      }
    }
    if (result.reason === 'unknown') {
      return {
        status: 'unknown',
        message: UNKNOWN_DRAFT_UPDATE_MESSAGE,
      }
    }
    return {
      status: 'error',
      message:
        'The hosted draft could not be saved. No partial change was made.',
    }
  }

  revalidatePath('/experiments')
  revalidatePath('/dashboard')
  revalidatePath(`/experiments/${result.experimentId}`)
  redirect(`/experiments/${result.experimentId}`)
}

export async function mutateHostedLockedExperimentLifecycle(
  _previousState: HostedLifecycleActionState,
  formData: FormData,
): Promise<HostedLifecycleActionState> {
  const context = await getHostedOwnerMutationContext()

  if (context.status === 'unconfigured') {
    return {
      status: 'error',
      message: 'Hosted lifecycle controls are unavailable in local mock mode.',
    }
  }
  if (context.status === 'unauthenticated') {
    redirect('/login?reason=session-expired')
  }
  if (context.status === 'unauthorized') {
    await context.supabase.auth.signOut()
    redirect('/login?reason=unauthorized')
  }
  if (context.status === 'unavailable') {
    return {
      status: 'error',
      message: 'Owner verification is temporarily unavailable. Try again.',
    }
  }

  const parsed = parseHostedLifecycleForm(formData)
  if (!parsed.success) return parsed.state

  let mutation: Awaited<ReturnType<typeof mutateHostedLifecycle>>
  try {
    mutation = await mutateHostedLifecycle(context.supabase, parsed.data)
  } catch {
    return { status: 'unknown', message: UNKNOWN_LIFECYCLE_MESSAGE }
  }

  if (!mutation.ok) {
    if (mutation.reason === 'conflict') {
      return {
        status: 'error',
        message: 'This experiment changed. Reload before trying again.',
      }
    }
    if (mutation.reason === 'invalid') {
      return {
        status: 'error',
        message: 'Review the lifecycle action and confirmation fields.',
      }
    }
    if (mutation.reason === 'transition') {
      return {
        status: 'error',
        message:
          'This lifecycle change is not currently allowed. Reload and review the experiment state.',
      }
    }
    if (mutation.reason === 'unknown') {
      return { status: 'unknown', message: UNKNOWN_LIFECYCLE_MESSAGE }
    }
    return {
      status: 'error',
      message: 'The lifecycle change was rejected. No partial change was made.',
    }
  }

  revalidatePath('/experiments')
  revalidatePath('/dashboard')
  revalidatePath(`/experiments/${parsed.data.experimentId}`)
  revalidatePath(`/experiments/${mutation.result.experimentId}`)
  redirect(`/experiments/${mutation.result.experimentId}`)
}
