import { createHash } from 'node:crypto'

import {
  CURRENT_MODEL_PRICING,
  type ModelId,
} from '../src/domain/budgets/pricing'

const models = Object.keys(CURRENT_MODEL_PRICING) as ModelId[]

function pageContainsPrice(page: string, value: string): boolean {
  const normalized = value.replace(/\.00$/, '')
  return [`$${value}`, `$${normalized}`, `>${value}<`, `>${normalized}<`].some(
    (candidate) => page.includes(candidate),
  )
}

const reviewedAt = new Date().toISOString()
const records = []

for (const model of models) {
  const expected = CURRENT_MODEL_PRICING[model]
  const response = await fetch(expected.sourceUrl, {
    signal: AbortSignal.timeout(15_000),
    headers: { Accept: 'text/html,text/plain;q=0.9' },
  })
  if (!response.ok) {
    throw new Error(
      `Official pricing page for ${model} returned HTTP ${response.status}`,
    )
  }
  const page = await response.text()
  for (const value of [
    expected.inputPerMillionUsd,
    expected.cachedInputPerMillionUsd,
    expected.outputPerMillionUsd,
  ]) {
    if (!pageContainsPrice(page, value)) {
      throw new Error(
        `Expected official price metadata was not found for ${model}`,
      )
    }
  }
  const payload = [
    model,
    expected.pricingMode,
    expected.contextTier,
    expected.inputPerMillionUsd,
    expected.cachedInputPerMillionUsd,
    expected.cacheWritePerMillionUsd,
    expected.outputPerMillionUsd,
    expected.currency,
    reviewedAt.slice(0, 10),
  ].join('|')
  records.push({
    model,
    sourceUrl: expected.sourceUrl,
    reviewedAt,
    proposedChecksum: createHash('sha256').update(payload).digest('hex'),
    pricesMatchCurrentRecord: true,
  })
}

process.stdout.write(
  `${JSON.stringify({ status: 'verified', records }, null, 2)}\n`,
)
