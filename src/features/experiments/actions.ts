'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import {
  type HostedDraftActionState,
  parseHostedDraftForm,
} from '@/features/experiments/create-hosted-draft'
import { getHostedOwnerMutationContext } from '@/lib/auth/hosted-owner-mutation'
import { createHostedDraftExperiment as createHostedDraft } from '@/lib/supabase/experiment-write-repository'

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
