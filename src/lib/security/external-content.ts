import { z } from 'zod'

const externalContentSchema = z.object({
  sourceId: z.string().min(1).max(200),
  title: z.string().max(1_000),
  text: z.string().max(100_000),
  canonicalUrl: z.url(),
})

export type ExternalContent = z.infer<typeof externalContentSchema>

export function sanitizeExternalContent(input: unknown): ExternalContent {
  const value = externalContentSchema.parse(input)
  const stripControls = (text: string) =>
    text
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .replace(/\r\n?/g, '\n')
      .trim()
  return {
    ...value,
    title: stripControls(value.title),
    text: stripControls(value.text),
  }
}

export function delimitUntrustedContent(content: ExternalContent): string {
  return [
    '<UNTRUSTED_EXTERNAL_EVIDENCE>',
    `source_id: ${content.sourceId}`,
    `canonical_url: ${content.canonicalUrl}`,
    `title: ${content.title}`,
    'content:',
    content.text,
    '</UNTRUSTED_EXTERNAL_EVIDENCE>',
  ].join('\n')
}
