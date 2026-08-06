import {
  decimal,
  decimalValue,
  type DecimalValue,
} from '@/domain/financial/decimal'

export type ModelId = 'gpt-5.6-luna' | 'gpt-5.6-terra' | 'gpt-5.6-sol'

export type ModelPricing = {
  model: ModelId
  pricingMode: 'standard'
  contextTier: 'short'
  inputPerMillionUsd: DecimalValue
  cachedInputPerMillionUsd: DecimalValue
  cacheWritePerMillionUsd: DecimalValue
  outputPerMillionUsd: DecimalValue
  sourceUrl: string
  effectiveFrom: string
  effectiveTo?: string
}

export const CURRENT_MODEL_PRICING: Readonly<Record<ModelId, ModelPricing>> = {
  'gpt-5.6-luna': {
    model: 'gpt-5.6-luna',
    pricingMode: 'standard',
    contextTier: 'short',
    inputPerMillionUsd: '0.20',
    cachedInputPerMillionUsd: '0.02',
    cacheWritePerMillionUsd: '0.25',
    outputPerMillionUsd: '1.20',
    sourceUrl: 'https://developers.openai.com/api/docs/pricing',
    effectiveFrom: '2026-08-06T00:00:00.000Z',
  },
  'gpt-5.6-terra': {
    model: 'gpt-5.6-terra',
    pricingMode: 'standard',
    contextTier: 'short',
    inputPerMillionUsd: '2.00',
    cachedInputPerMillionUsd: '0.20',
    cacheWritePerMillionUsd: '2.50',
    outputPerMillionUsd: '12.00',
    sourceUrl: 'https://developers.openai.com/api/docs/pricing',
    effectiveFrom: '2026-08-06T00:00:00.000Z',
  },
  'gpt-5.6-sol': {
    model: 'gpt-5.6-sol',
    pricingMode: 'standard',
    contextTier: 'short',
    inputPerMillionUsd: '5.00',
    cachedInputPerMillionUsd: '0.50',
    cacheWritePerMillionUsd: '6.25',
    outputPerMillionUsd: '30.00',
    sourceUrl: 'https://developers.openai.com/api/docs/pricing',
    effectiveFrom: '2026-08-06T00:00:00.000Z',
  },
}

export const WEB_SEARCH_PER_CALL_USD: DecimalValue = '0.01'

export type TokenUsage = {
  /** Billable non-cached input tokens. */
  inputTokens: string
  /** Input tokens billed at the cached-input rate. */
  cachedInputTokens: string
  cacheWriteTokens: string
  outputTokens: string
  webSearchCalls: string
}

export function resolveEffectivePricing(
  prices: readonly ModelPricing[],
  model: ModelId,
  at: string,
): ModelPricing {
  const requestedAt = new Date(at).getTime()
  if (Number.isNaN(requestedAt))
    throw new TypeError('Invalid pricing timestamp')

  const matches = prices
    .filter((price) => {
      if (price.model !== model) return false
      const startsAt = new Date(price.effectiveFrom).getTime()
      const endsAt = price.effectiveTo
        ? new Date(price.effectiveTo).getTime()
        : Number.POSITIVE_INFINITY
      return startsAt <= requestedAt && requestedAt < endsAt
    })
    .sort(
      (left, right) =>
        new Date(right.effectiveFrom).getTime() -
        new Date(left.effectiveFrom).getTime(),
    )

  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? `No effective pricing for ${model}`
        : `Overlapping effective pricing for ${model}`,
    )
  }
  return matches[0]
}

export function calculateUsageCost(
  pricing: ModelPricing,
  usage: TokenUsage,
): DecimalValue {
  const million = decimal('1000000')
  const input = decimal(usage.inputTokens)
    .mul(pricing.inputPerMillionUsd)
    .div(million)
  const cachedInput = decimal(usage.cachedInputTokens)
    .mul(pricing.cachedInputPerMillionUsd)
    .div(million)
  const cacheWrite = decimal(usage.cacheWriteTokens)
    .mul(pricing.cacheWritePerMillionUsd)
    .div(million)
  const output = decimal(usage.outputTokens)
    .mul(pricing.outputPerMillionUsd)
    .div(million)
  const search = decimal(usage.webSearchCalls).mul(WEB_SEARCH_PER_CALL_USD)
  return decimalValue(
    input.plus(cachedInput).plus(cacheWrite).plus(output).plus(search),
  )
}
