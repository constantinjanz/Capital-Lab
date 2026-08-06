'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'

import { createSupabaseServerClient } from '@/lib/auth/supabase/server'

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(256),
})

export async function signIn(formData: FormData): Promise<void> {
  const credentials = credentialsSchema.parse({
    email: formData.get('email'),
    password: formData.get('password'),
  })
  const supabase = await createSupabaseServerClient()
  if (!supabase) redirect('/dashboard')
  const { error } = await supabase.auth.signInWithPassword(credentials)
  if (error) redirect('/login?reason=invalid-credentials')
  redirect('/dashboard')
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient()
  if (supabase) await supabase.auth.signOut()
  redirect('/login')
}
