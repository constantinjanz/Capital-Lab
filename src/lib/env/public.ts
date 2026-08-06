import { z } from 'zod'

const publicEnvironmentSchema = z
  .object({
    NEXT_PUBLIC_SUPABASE_URL: z.url().optional(),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
  })
  .superRefine((value, context) => {
    const configured = Boolean(
      value.NEXT_PUBLIC_SUPABASE_URL &&
      value.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    )
    const partiallyConfigured = Boolean(
      value.NEXT_PUBLIC_SUPABASE_URL ||
      value.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    )
    if (partiallyConfigured && !configured) {
      context.addIssue({
        code: 'custom',
        message: 'Supabase public URL and publishable key must be set together',
      })
    }
  })

export type PublicEnvironment = z.infer<typeof publicEnvironmentSchema>

export function getPublicEnvironment(): PublicEnvironment {
  return publicEnvironmentSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || undefined,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || undefined,
  })
}

export function isSupabasePubliclyConfigured(): boolean {
  const environment = getPublicEnvironment()
  return Boolean(
    environment.NEXT_PUBLIC_SUPABASE_URL &&
    environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  )
}
