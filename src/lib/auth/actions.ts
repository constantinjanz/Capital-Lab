'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'

import {
  getOwnerConfirmationRedirectUrl,
  isExpectedOwnerEmail,
} from '@/lib/auth/owner-bootstrap'
import { createSupabaseServerClient } from '@/lib/auth/supabase/server'
import { getServerEnvironment } from '@/lib/env/server'

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(256),
})

const registrationSchema = z
  .object({
    email: z.email(),
    password: z.string().min(12).max(256),
    confirmPassword: z.string().min(12).max(256),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: 'Passwords must match',
    path: ['confirmPassword'],
  })

async function bindSignedInOwner(
  supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>,
): Promise<boolean> {
  const { error } = await supabase.rpc('bootstrap_first_owner')
  if (!error) return true
  await supabase.auth.signOut()
  return false
}

export async function signIn(formData: FormData): Promise<void> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success) redirect('/login?reason=invalid-credentials')

  const supabase = await createSupabaseServerClient()
  if (!supabase) redirect('/dashboard')
  const { error } = await supabase.auth.signInWithPassword(parsed.data)
  if (error) redirect('/login?reason=invalid-credentials')
  if (!(await bindSignedInOwner(supabase))) {
    redirect('/login?reason=unauthorized')
  }
  redirect('/dashboard')
}

export async function registerOwner(formData: FormData): Promise<void> {
  const parsed = registrationSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  })
  if (!parsed.success) redirect('/login?reason=invalid-registration')

  const environment = getServerEnvironment()
  if (
    !environment.OWNER_BOOTSTRAP_ENABLED ||
    !isExpectedOwnerEmail(parsed.data.email, environment.OWNER_EMAIL)
  ) {
    redirect('/login?reason=registration-unavailable')
  }

  const supabase = await createSupabaseServerClient()
  if (!supabase) redirect('/login?reason=registration-unavailable')

  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email.trim().toLocaleLowerCase('en-US'),
    password: parsed.data.password,
    options: {
      emailRedirectTo: getOwnerConfirmationRedirectUrl(
        environment.APP_BASE_URL,
      ),
    },
  })
  if (error) redirect('/login?reason=registration-unavailable')

  if (data.session) {
    if (!(await bindSignedInOwner(supabase))) {
      redirect('/login?reason=registration-unavailable')
    }
    redirect('/dashboard')
  }

  redirect('/login?reason=check-email')
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient()
  if (supabase) await supabase.auth.signOut()
  redirect('/login')
}
