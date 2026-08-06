import { z } from 'zod'

export const sourceEventSchema = z.object({
  externalId: z.string().min(1),
  canonicalUrl: z.url(),
  sourceType: z.enum([
    'sec',
    'federal_reserve',
    'bls',
    'white_house',
    'company_ir',
    'licensed_news',
    'social_official',
  ]),
  issuingAuthority: z.string().min(1),
  title: z.string().min(1),
  sanitizedText: z.string(),
  contentHash: z.string().min(1),
  language: z.string().default('en'),
  publishedAt: z.iso.datetime(),
  providerReceivedAt: z.iso.datetime().optional(),
  firstSeenAt: z.iso.datetime(),
  availableAt: z.iso.datetime(),
  revisionOf: z.string().optional(),
  sourceQuality: z.enum(['primary', 'licensed', 'secondary']),
  licensing: z.string().min(1),
  retentionPolicy: z.string().min(1),
  synthetic: z.boolean(),
})

export type SourceEvent = z.infer<typeof sourceEventSchema>
