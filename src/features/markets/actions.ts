'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import {
  type HostedMarketConfigurationActionState,
  parseHostedMarketConfigurationForm,
} from '@/features/markets/configure-hosted-market'
import { getHostedOwnerMutationContext } from '@/lib/auth/hosted-owner-mutation'
import { writeHostedMarketConfiguration } from '@/lib/supabase/market-configuration-write-repository'

const UNKNOWN_CONFIGURATION_MESSAGE =
  'The configuration result could not be confirmed. Retry this same setup or reload Markets before continuing.'

export async function configureHostedMarketManifest(
  _previousState: HostedMarketConfigurationActionState,
  formData: FormData,
): Promise<HostedMarketConfigurationActionState> {
  const context = await getHostedOwnerMutationContext()

  if (context.status === 'unconfigured') {
    return {
      status: 'error',
      message: 'Hosted market configuration is unavailable in local mock mode.',
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

  const parsed = parseHostedMarketConfigurationForm(formData)
  if (!parsed.success) return parsed.state

  let result: Awaited<ReturnType<typeof writeHostedMarketConfiguration>>
  try {
    result = await writeHostedMarketConfiguration(context.supabase, parsed.data)
  } catch {
    return { status: 'unknown', message: UNKNOWN_CONFIGURATION_MESSAGE }
  }

  if (!result.ok) {
    if (result.reason === 'unknown') {
      return { status: 'unknown', message: UNKNOWN_CONFIGURATION_MESSAGE }
    }
    return {
      status: 'error',
      message:
        'The reviewed configuration was rejected. No partial market configuration was accepted.',
    }
  }

  revalidatePath('/markets')
  return {
    status: 'success',
    message: result.replayed
      ? 'This reviewed configuration was already saved. No data was fetched and no activation state changed.'
      : 'Reviewed configuration saved. No data was fetched, no credentials were added, and no activation state changed.',
  }
}
