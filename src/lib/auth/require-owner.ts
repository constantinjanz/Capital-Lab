import 'server-only'

import { redirect } from 'next/navigation'

import { createSupabaseServerClient } from '@/lib/auth/supabase/server'

export type OwnerIdentity = {
  id: string
  email: string
  mode: 'mock' | 'supabase'
}

export async function getOwnerIdentity(): Promise<OwnerIdentity | null> {
  const supabase = await createSupabaseServerClient()
  if (!supabase) {
    return {
      id: '00000000-0000-4000-8000-000000000001',
      email: 'owner@capital-lab.local',
      mode: 'mock',
    }
  }

  const { data } = await supabase.auth.getClaims()
  const subject = data?.claims?.sub
  const email =
    typeof data?.claims?.email === 'string' ? data.claims.email : null
  if (!subject || !email) return null

  const { data: owner } = await supabase
    .from('app_users')
    .select('user_id,is_active')
    .eq('user_id', subject)
    .eq('role', 'owner')
    .eq('is_active', true)
    .maybeSingle()
  if (!owner) return null
  return { id: subject, email, mode: 'supabase' }
}

export async function requireOwner(): Promise<OwnerIdentity> {
  const owner = await getOwnerIdentity()
  if (!owner) redirect('/login?reason=unauthorized')
  return owner
}
