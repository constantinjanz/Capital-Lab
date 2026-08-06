import { z } from 'zod'

export const lunaCandidateDecisionSchema = z.object({
  candidateId: z.string().min(1),
  relevant: z.boolean(),
  materialityScore: z.int().min(0).max(100),
  noveltyScore: z.int().min(0).max(100),
  urgency: z.enum(['low', 'normal', 'high', 'immediate']),
  linkedSymbols: z.array(z.string().min(1).max(32)).max(20),
  eventCategory: z.string().min(1).max(100),
  expectedHorizon: z.enum([
    '15_minutes',
    '1_hour',
    'end_of_day',
    '1_trading_day',
    '5_trading_days',
  ]),
  reasonSummary: z.string().min(1).max(500),
  escalateToTerra: z.boolean(),
})

export const lunaDecisionSchema = z.object({
  candidates: z.array(lunaCandidateDecisionSchema).max(10),
})

export type LunaDecision = z.infer<typeof lunaDecisionSchema>

const scenarioSchema = z.object({
  summary: z.string().min(1).max(700),
  probabilityPercent: z.int().min(0).max(100),
})

export const tradeProposalSchema = z.object({
  decisionType: z.enum([
    'buy',
    'sell',
    'sell_short',
    'buy_to_cover',
    'reduce',
    'close',
    'hold',
    'abstain',
  ]),
  instrumentId: z.string().min(1).optional(),
  symbol: z.string().min(1).max(32).optional(),
  eventIds: z.array(z.string().min(1)).max(20),
  evidenceIds: z.array(z.string().min(1)).min(1).max(30),
  thesis: z.string().min(1).max(1_000),
  scenarios: z.object({
    bull: scenarioSchema,
    base: scenarioSchema,
    bear: scenarioSchema,
  }),
  confidencePercent: z.int().min(0).max(100),
  expectedDirection: z.enum(['up', 'down', 'flat', 'uncertain']),
  expectedReturnRangeBps: z.object({
    minimum: z.int().min(-100_000).max(100_000),
    maximum: z.int().min(-100_000).max(100_000),
  }),
  intendedHorizon: z.enum([
    '15_minutes',
    '1_hour',
    'end_of_day',
    '1_trading_day',
    '5_trading_days',
  ]),
  targetExposureFraction: z
    .string()
    .regex(/^0(?:\.\d+)?$|^1(?:\.0+)?$/)
    .optional(),
  invalidationConditions: z.array(z.string().min(1).max(400)).max(10),
  urgency: z.enum(['low', 'normal', 'high', 'immediate']),
  preferredOrderType: z
    .enum(['market', 'limit', 'stop', 'stop_limit'])
    .optional(),
  priceConstraint: z
    .string()
    .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/)
    .optional(),
  escalationRequested: z.boolean(),
  abstentionReason: z.string().max(700).optional(),
})

export type TradeProposal = z.infer<typeof tradeProposalSchema>

export function validateProposalSemantics(
  proposal: TradeProposal,
): TradeProposal {
  const abstains =
    proposal.decisionType === 'hold' || proposal.decisionType === 'abstain'
  if (!abstains && (!proposal.instrumentId || !proposal.symbol)) {
    throw new Error('Actionable proposals require an instrument and symbol')
  }
  if (proposal.decisionType === 'abstain' && !proposal.abstentionReason) {
    throw new Error('Abstentions require a concise reason')
  }
  if (
    proposal.expectedReturnRangeBps.minimum >
    proposal.expectedReturnRangeBps.maximum
  ) {
    throw new Error('Expected return range is inverted')
  }
  return proposal
}
