import 'server-only'

import { createSupabaseServerClient } from '@/lib/auth/supabase/server'

export async function getHostedOwnerMutationContext() {
  const supabase = await createSupabaseServerClient()
  if (!supabase) return { status: 'unconfigured' as const }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()
  if (userError || !user) {
    return { status: 'unauthenticated' as const, supabase }
  }

  const { data: owner, error: ownerError } = await supabase
    .from('app_users')
    .select('user_id')
    .eq('user_id', user.id)
    .eq('role', 'owner')
    .eq('is_active', true)
    .maybeSingle()

  if (ownerError) return { status: 'unavailable' as const, supabase }
  if (!owner) return { status: 'unauthorized' as const, supabase }

  return {
    status: 'ready' as const,
    ownerId: owner.user_id,
    supabase,
  }
}
