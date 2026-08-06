import { z } from 'zod'

import {
  chunkResearchDocument,
  type ResearchImportPreview,
} from '@/domain/memory/research'

export function previewMarkdownImport(input: {
  sourceId: string
  title: string
  markdown: string
  availableAt: string
  sourceQuality: 'primary' | 'licensed' | 'secondary' | 'synthetic'
  tags?: string[]
  existingHashes?: ReadonlySet<string>
}): ResearchImportPreview {
  return chunkResearchDocument(
    {
      sourceId: input.sourceId,
      title: input.title,
      content: input.markdown,
      availableAt: input.availableAt,
      sourceQuality: input.sourceQuality,
      tags: input.tags ?? [],
    },
    input.existingHashes,
  )
}

export const strategyCardSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.int().positive(),
  hypothesis: z.string().min(1),
  eligibleUniverse: z.array(z.string().min(1)).min(1),
  entryConditions: z.array(z.string().min(1)).min(1),
  exitConditions: z.array(z.string().min(1)).min(1),
  invalidationConditions: z.array(z.string().min(1)).min(1),
  maximumHoldingPeriod: z.string().min(1),
  sourceIds: z.array(z.string().min(1)),
})

export function previewStrategyCardImport(
  rawJson: string,
  availableAt: string,
): ResearchImportPreview {
  const card = strategyCardSchema.parse(JSON.parse(rawJson) as unknown)
  return chunkResearchDocument({
    sourceId: `strategy-card:${card.id}:v${card.version}`,
    title: card.name,
    content: JSON.stringify(card, null, 2),
    availableAt,
    sourceQuality: 'secondary',
    tags: ['strategy-card'],
  })
}

export const sourceRegistryRowSchema = z.object({
  source_id: z.string().min(1),
  name: z.string().min(1),
  canonical_url: z.url(),
  source_type: z.string().min(1),
  licensing: z.string().min(1),
  retention_policy: z.string().min(1),
  enabled: z.enum(['true', 'false']).transform((value) => value === 'true'),
})

export type SourceRegistryRow = z.infer<typeof sourceRegistryRowSchema>

function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index]
    if (quoted) {
      if (character === '"' && csv[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (character === '"') quoted = false
      else field += character
    } else if (character === '"') quoted = true
    else if (character === ',') {
      row.push(field.trim())
      field = ''
    } else if (character === '\n') {
      row.push(field.trim())
      if (row.some(Boolean)) rows.push(row)
      row = []
      field = ''
    } else if (character !== '\r') field += character
  }
  row.push(field.trim())
  if (row.some(Boolean)) rows.push(row)
  if (quoted) throw new Error('Unterminated quoted CSV field')
  return rows
}

export function previewSourceRegistryImport(csv: string): SourceRegistryRow[] {
  const rows = parseCsvRows(csv)
  const header = rows.shift()
  if (!header) return []
  return rows.map((row) =>
    sourceRegistryRowSchema.parse(
      Object.fromEntries(header.map((name, index) => [name, row[index] ?? ''])),
    ),
  )
}
