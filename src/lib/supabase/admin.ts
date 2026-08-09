import 'server-only'

import { createClient } from '@supabase/supabase-js'

import { getPublicEnvironment } from '@/lib/env/public'
import { getServerEnvironment } from '@/lib/env/server'
import type { Database } from '@/lib/supabase/database.types'

export function createSupabaseAdminClient() {
  const publicEnvironment = getPublicEnvironment()
  const serverEnvironment = getServerEnvironment()
  if (
    !publicEnvironment.NEXT_PUBLIC_SUPABASE_URL ||
    !serverEnvironment.SUPABASE_SECRET_KEY
  ) {
    return null
  }

  return createClient<Database>(
    publicEnvironment.NEXT_PUBLIC_SUPABASE_URL,
    serverEnvironment.SUPABASE_SECRET_KEY,
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    },
  )
}
