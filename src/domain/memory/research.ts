import { createHash } from 'node:crypto'

import { z } from 'zod'

export const researchDocumentInputSchema = z.object({
  sourceId: z.string().min(1),
  title: z.string().min(1).max(500),
  content: z.string().min(1).max(2_000_000),
  availableAt: z.iso.datetime(),
  sourceQuality: z.enum(['primary', 'licensed', 'secondary', 'synthetic']),
  tags: z.array(z.string().min(1).max(100)).max(50).default([]),
})

export type ResearchDocumentInput = z.infer<typeof researchDocumentInputSchema>

export type KnowledgeChunk = {
  id: string
  documentVersionHash: string
  position: number
  text: string
  tokenEstimate: number
  contentHash: string
  availableAt: string
  sourceId: string
  sourceQuality: ResearchDocumentInput['sourceQuality']
  tags: string[]
}

export type ResearchImportPreview = {
  documentVersionHash: string
  contentHash: string
  duplicate: boolean
  chunks: KnowledgeChunk[]
  warnings: string[]
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function normalizeResearchText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function chunkResearchDocument(
  rawInput: unknown,
  existingHashes: ReadonlySet<string> = new Set(),
  maximumCharacters = 1_200,
): ResearchImportPreview {
  const input = researchDocumentInputSchema.parse(rawInput)
  const content = normalizeResearchText(input.content)
  const contentHash = sha256(content)
  const versionHash = sha256(
    JSON.stringify({
      sourceId: input.sourceId,
      title: input.title,
      contentHash,
      availableAt: input.availableAt,
      tags: [...input.tags].sort(),
    }),
  )
  const paragraphs = content.split(/\n\n+/)
  const blocks: string[] = []
  let current = ''
  for (const paragraph of paragraphs) {
    if (paragraph.length > maximumCharacters) {
      if (current) blocks.push(current)
      current = ''
      for (
        let index = 0;
        index < paragraph.length;
        index += maximumCharacters
      ) {
        blocks.push(paragraph.slice(index, index + maximumCharacters))
      }
    } else if (!current) current = paragraph
    else if (`${current}\n\n${paragraph}`.length <= maximumCharacters) {
      current = `${current}\n\n${paragraph}`
    } else {
      blocks.push(current)
      current = paragraph
    }
  }
  if (current) blocks.push(current)

  return {
    documentVersionHash: versionHash,
    contentHash,
    duplicate: existingHashes.has(contentHash),
    chunks: blocks.map((text, position) => {
      const hash = sha256(text)
      return {
        id: `evidence:${versionHash.slice(0, 16)}:${position}`,
        documentVersionHash: versionHash,
        position,
        text,
        tokenEstimate: Math.ceil(text.length / 4),
        contentHash: hash,
        availableAt: input.availableAt,
        sourceId: input.sourceId,
        sourceQuality: input.sourceQuality,
        tags: input.tags,
      }
    }),
    warnings:
      input.sourceQuality === 'synthetic'
        ? ['Synthetic research fixture: never present as live evidence']
        : [],
  }
}

export function pointInTimeChunks(
  chunks: readonly KnowledgeChunk[],
  decisionAt: string,
): KnowledgeChunk[] {
  const cutoff = new Date(decisionAt).getTime()
  if (Number.isNaN(cutoff)) throw new TypeError('Invalid decision timestamp')
  return chunks.filter(
    (chunk) => new Date(chunk.availableAt).getTime() <= cutoff,
  )
}
