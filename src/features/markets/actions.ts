'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import {
  type HostedMarketConfigurationActionState,
  parseHostedMarketConfigurationForm,
} from '@/features/markets/configure-hosted-market'
import {
  type HostedOfficialCalendarConfigurationActionState,
  parseHostedOfficialCalendarConfigurationForm,
} from '@/features/markets/hosted-official-calendar'
import {
  deriveHostedMarketIngestionReadiness,
  type HostedMarketMutationActionState,
  parseHostedMarketIngestionForm,
  parseHostedSourceLifecycleForm,
} from '@/features/markets/hosted-market-ingestion'
import { runOwnerTriggeredAlpacaIngestion } from '@/features/markets/run-hosted-market-ingestion'
import { getHostedOwnerMutationContext } from '@/lib/auth/hosted-owner-mutation'
import { getServerEnvironment } from '@/lib/env/server'
import { writeHostedMarketConfiguration } from '@/lib/supabase/market-configuration-write-repository'
import {
  createHostedMarketIngestionPersistence,
  setHostedMarketSourceEnabled,
} from '@/lib/supabase/market-ingestion-write-repository'
import { writeHostedOfficialCalendarConfiguration } from '@/lib/supabase/official-calendar-write-repository'
import { AlpacaMarketDataProvider } from '@/providers/market-data/alpaca'

const UNKNOWN_CONFIGURATION_MESSAGE =
  'The configuration result could not be confirmed. Retry this same setup or reload Markets before continuing.'
const UNKNOWN_SOURCE_MESSAGE =
  'The source lifecycle result could not be confirmed. Retry this same operation or reload Markets before continuing.'
const UNKNOWN_INGESTION_MESSAGE =
  'The ingestion result could not be confirmed. Retry this same operation or reload Markets before continuing.'
const UNKNOWN_CALENDAR_MESSAGE =
  'The calendar setup result could not be confirmed. Retry this same setup or reload Markets before continuing.'

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

export async function configureHostedOfficialCalendarManifest(
  _previousState: HostedOfficialCalendarConfigurationActionState,
  formData: FormData,
): Promise<HostedOfficialCalendarConfigurationActionState> {
  const context = await getHostedOwnerMutationContext()

  if (context.status === 'unconfigured') {
    return {
      status: 'error',
      message: 'Official calendar setup is unavailable in local mock mode.',
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

  const parsed = parseHostedOfficialCalendarConfigurationForm(formData)
  if (!parsed.success) return parsed.state

  let result: Awaited<
    ReturnType<typeof writeHostedOfficialCalendarConfiguration>
  >
  try {
    result = await writeHostedOfficialCalendarConfiguration(
      context.supabase,
      parsed.data,
    )
  } catch {
    return { status: 'unknown', message: UNKNOWN_CALENDAR_MESSAGE }
  }

  if (!result.ok) {
    return result.reason === 'unknown'
      ? { status: 'unknown', message: UNKNOWN_CALENDAR_MESSAGE }
      : {
          status: 'error',
          message:
            'The reviewed official calendar was rejected. No partial calendar configuration was accepted.',
        }
  }

  revalidatePath('/markets')
  return {
    status: 'success',
    message: result.replayed
      ? 'This reviewed 2026 calendar was already saved. No provider or scheduler state changed.'
      : 'Reviewed 2026 XNAS/ARCX calendar saved. No provider request was made and scheduling remains disabled.',
  }
}

export async function setHostedAlpacaSourceState(
  _previousState: HostedMarketMutationActionState,
  formData: FormData,
): Promise<HostedMarketMutationActionState> {
  const context = await getHostedOwnerMutationContext()

  if (context.status === 'unconfigured') {
    return {
      status: 'error',
      message:
        'Hosted market source controls are unavailable in local mock mode.',
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

  const parsed = parseHostedSourceLifecycleForm(formData)
  if (!parsed.success) return parsed.state

  if (parsed.data.enabled) {
    try {
      const readiness = deriveHostedMarketIngestionReadiness(
        getServerEnvironment(),
      )
      if (!readiness.ready) {
        return { status: 'blocked', message: readiness.message }
      }
    } catch {
      return {
        status: 'blocked',
        message: 'The server-side market data environment is not valid.',
      }
    }
  }

  let result: Awaited<ReturnType<typeof setHostedMarketSourceEnabled>>
  try {
    result = await setHostedMarketSourceEnabled(context.supabase, parsed.data)
  } catch {
    return { status: 'unknown', message: UNKNOWN_SOURCE_MESSAGE }
  }

  if (!result.ok) {
    return result.reason === 'unknown'
      ? { status: 'unknown', message: UNKNOWN_SOURCE_MESSAGE }
      : {
          status: 'error',
          message:
            'The reviewed source lifecycle change was rejected. No partial state was accepted.',
        }
  }

  revalidatePath('/markets')
  return {
    status: result.value.replayed ? 'replayed' : 'success',
    message: result.value.replayed
      ? `The Alpaca IEX source was already ${result.value.enabled ? 'enabled' : 'disabled'}.`
      : `Alpaca IEX source ${result.value.enabled ? 'enabled' : 'disabled'}. No market data was fetched.`,
  }
}

export async function runHostedAlpacaIngestion(
  _previousState: HostedMarketMutationActionState,
  formData: FormData,
): Promise<HostedMarketMutationActionState> {
  const context = await getHostedOwnerMutationContext()

  if (context.status === 'unconfigured') {
    return {
      status: 'error',
      message: 'Hosted market ingestion is unavailable in local mock mode.',
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

  const parsed = parseHostedMarketIngestionForm(formData)
  if (!parsed.success) return parsed.state

  let environment: ReturnType<typeof getServerEnvironment>
  try {
    environment = getServerEnvironment()
  } catch {
    return {
      status: 'blocked',
      message: 'The server-side market data environment is not valid.',
    }
  }
  const readiness = deriveHostedMarketIngestionReadiness(environment)
  if (!readiness.ready) {
    return { status: 'blocked', message: readiness.message }
  }
  const keyId = environment.ALPACA_API_KEY_ID
  const secretKey = environment.ALPACA_API_SECRET_KEY
  if (!keyId || !secretKey) {
    return {
      status: 'blocked',
      message: 'Server-side Alpaca Market Data credentials are not configured.',
    }
  }

  let outcome: Awaited<ReturnType<typeof runOwnerTriggeredAlpacaIngestion>>
  try {
    outcome = await runOwnerTriggeredAlpacaIngestion({
      request: parsed.data,
      persistence: createHostedMarketIngestionPersistence(context.supabase),
      provider: new AlpacaMarketDataProvider({
        keyId,
        secretKey,
        feed: 'iex',
      }),
    })
  } catch {
    return { status: 'unknown', message: UNKNOWN_INGESTION_MESSAGE }
  }

  if (outcome.status === 'unknown') {
    return { status: 'unknown', message: UNKNOWN_INGESTION_MESSAGE }
  }
  if (outcome.status === 'rejected') {
    return {
      status: 'error',
      message:
        'The reviewed ingestion was rejected. No unconfirmed market evidence was accepted.',
    }
  }
  if (outcome.status === 'provider-error') {
    revalidatePath('/markets')
    return {
      status: 'provider-error',
      message:
        'Alpaca Market Data did not produce a valid reviewed batch. The failed run was recorded without exposing provider details.',
    }
  }

  if (!outcome.result.finishedAt) {
    return { status: 'unknown', message: UNKNOWN_INGESTION_MESSAGE }
  }

  revalidatePath('/markets')
  return {
    status: outcome.status === 'replayed' ? 'replayed' : 'success',
    message:
      outcome.status === 'replayed'
        ? 'This ingestion operation was already completed; the recorded result is shown below.'
        : 'The reviewed Alpaca IEX batch was committed as market evidence.',
    summary: {
      recordsSeen: outcome.result.recordsSeen,
      recordsInserted: outcome.result.recordsInserted,
      recordsDeduplicated: outcome.result.recordsReused,
      availableAt: outcome.result.finishedAt,
    },
  }
}
