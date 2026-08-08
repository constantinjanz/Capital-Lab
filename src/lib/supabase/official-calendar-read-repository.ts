import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import {
  mapHostedOfficialCalendarState,
  type HostedOfficialCalendarState,
} from '@/features/markets/hosted-official-calendar'
import { createSupabaseServerClient } from '@/lib/auth/supabase/server'
import { log } from '@/lib/logging/logger'
import type { Database } from '@/lib/supabase/database.types'

async function readWithClient(
  supabase: SupabaseClient<Database>,
  ownerId: string,
): Promise<HostedOfficialCalendarState> {
  let response: { data: unknown; error: unknown }
  try {
    response = await supabase.rpc('hosted_official_calendar_state')
  } catch {
    return { status: 'unavailable', calendarYear: 2026 }
  }
  if (response.error) return { status: 'unavailable', calendarYear: 2026 }

  try {
    return mapHostedOfficialCalendarState(response.data, ownerId)
  } catch (error) {
    log('error', 'Hosted official calendar state validation failed', {
      operation: 'official_calendar_state_validation',
      errorClass: error instanceof Error ? error.name : 'UnknownThrownValue',
    })
    return { status: 'unavailable', calendarYear: 2026 }
  }
}

export async function readHostedOfficialCalendarStateWithClient(
  supabase: SupabaseClient<Database>,
  ownerId: string,
): Promise<HostedOfficialCalendarState> {
  return readWithClient(supabase, ownerId)
}

export async function readHostedOfficialCalendarState(
  ownerId: string,
): Promise<HostedOfficialCalendarState> {
  const supabase = await createSupabaseServerClient()
  if (!supabase) return { status: 'unavailable', calendarYear: 2026 }
  return readWithClient(supabase, ownerId)
}
