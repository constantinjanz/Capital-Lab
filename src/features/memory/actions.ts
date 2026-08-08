'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import {
  type HostedPatternReviewActionState,
  parseHostedPatternReviewForm,
} from '@/features/memory/hosted-pattern-review'
import { getHostedOwnerMutationContext } from '@/lib/auth/hosted-owner-mutation'
import { writeHostedPatternLifecycleReview } from '@/lib/supabase/pattern-lifecycle-write-repository'

const UNKNOWN_REVIEW_MESSAGE =
  'The pattern review result could not be confirmed. Reload Memory before trying another action.'

export async function reviewHostedPatternLifecycle(
  _previousState: HostedPatternReviewActionState,
  formData: FormData,
): Promise<HostedPatternReviewActionState> {
  const context = await getHostedOwnerMutationContext()

  if (context.status === 'unconfigured') {
    return {
      status: 'error',
      message: 'Hosted pattern review is unavailable in local mock mode.',
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

  const parsed = parseHostedPatternReviewForm(formData)
  if (!parsed.success) return parsed.state

  let mutation: Awaited<ReturnType<typeof writeHostedPatternLifecycleReview>>
  try {
    mutation = await writeHostedPatternLifecycleReview(
      context.supabase,
      parsed.data,
    )
  } catch {
    return { status: 'unknown', message: UNKNOWN_REVIEW_MESSAGE }
  }

  if (!mutation.ok) {
    return mutation.reason === 'unknown'
      ? { status: 'unknown', message: UNKNOWN_REVIEW_MESSAGE }
      : {
          status: 'error',
          message:
            'The pattern lifecycle review was rejected. Reload Memory and review the current evidence gate.',
        }
  }

  revalidatePath('/memory')
  return {
    status: 'success',
    message: mutation.result.replayed
      ? 'This exact owner review was already recorded. No assignment or allocation changed.'
      : `Pattern review recorded as ${mutation.result.lifecycleStatus}. No assignment, allocation, order, or fill was created.`,
  }
}
