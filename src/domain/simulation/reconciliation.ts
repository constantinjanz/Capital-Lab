import { decimal, decimalValue, type DecimalValue } from '../financial/decimal'
import { applySplitToLots } from './corporate-actions'
import { applyFillToLots, cashDeltaForFill, type PositionLot } from './lots'
import type { AccountedFill } from './types'

export type LedgerComponent =
  | 'trade_principal'
  | 'commission'
  | 'regulatory_fee'
  | 'fx_fee'
  | 'borrow_fee'
  | 'dividend'
  | 'cash_in_lieu'
  | 'other'

export interface CashLedgerEntry {
  readonly id: string
  readonly amountBase: DecimalValue
  readonly component: LedgerComponent
  readonly sourceType: 'fill' | 'corporate_action' | 'borrow' | 'manual'
  readonly sourceId: string
  readonly occurredAt: string
  readonly idempotencyKey: string
}

export type RebuildEvent =
  | {
      readonly kind: 'fill'
      readonly occurredAt: string
      readonly sequence: number
      readonly fill: AccountedFill
    }
  | {
      readonly kind: 'split'
      readonly occurredAt: string
      readonly sequence: number
      readonly actionId: string
      readonly instrumentId: string
      readonly ratio: DecimalValue
      readonly quantityIncrement: DecimalValue
    }

export interface ReconciliationDiscrepancy {
  readonly code:
    | 'CASH_MISMATCH'
    | 'LOT_MISMATCH'
    | 'POSITION_MISMATCH'
    | 'FILL_LEDGER_MISMATCH'
  readonly key: string
  readonly expected: DecimalValue | string
  readonly actual: DecimalValue | string
}

export interface MaterializedPosition {
  readonly instrumentId: string
  readonly side: 'long' | 'short' | 'flat'
  readonly quantity: DecimalValue
}

function eventId(event: RebuildEvent): string {
  return event.kind === 'fill' ? event.fill.id : event.actionId
}

export function rebuildLots(
  events: readonly RebuildEvent[],
): readonly PositionLot[] {
  let lots: readonly PositionLot[] = []
  const ordered = [...events].sort(
    (left, right) =>
      left.occurredAt.localeCompare(right.occurredAt) ||
      left.sequence - right.sequence ||
      eventId(left).localeCompare(eventId(right)),
  )
  const processed = new Set<string>()
  for (const event of ordered) {
    const key = `${event.kind}:${eventId(event)}`
    if (processed.has(key)) continue
    processed.add(key)
    if (event.kind === 'fill') lots = applyFillToLots(lots, event.fill).lots
    else {
      lots = applySplitToLots({
        lots,
        instrumentId: event.instrumentId,
        ratio: event.ratio,
        quantityIncrement: event.quantityIncrement,
      }).lots
    }
  }
  return lots
}

function positionsFromLots(
  lots: readonly PositionLot[],
): readonly MaterializedPosition[] {
  const quantities = new Map<
    string,
    { side: 'long' | 'short'; quantity: ReturnType<typeof decimal> }
  >()
  for (const lot of lots) {
    const quantity = decimal(lot.remainingQuantity)
    if (quantity.isZero()) continue
    const existing = quantities.get(lot.instrumentId)
    if (existing !== undefined && existing.side !== lot.side)
      throw new Error('Rebuilt crossed position')
    quantities.set(lot.instrumentId, {
      side: lot.side,
      quantity: (existing?.quantity ?? decimal('0')).plus(quantity),
    })
  }
  return [...quantities.entries()]
    .map(([instrumentId, position]) => ({
      instrumentId,
      side: position.side,
      quantity: decimalValue(position.quantity),
    }))
    .sort((left, right) => left.instrumentId.localeCompare(right.instrumentId))
}

export function reconcileAccount(input: {
  openingCashBase: DecimalValue
  ledgerEntries: readonly CashLedgerEntry[]
  events: readonly RebuildEvent[]
  materializedCashBase: DecimalValue
  materializedLots: readonly PositionLot[]
  materializedPositions: readonly MaterializedPosition[]
}): {
  readonly ok: boolean
  readonly expectedCashBase: DecimalValue
  readonly discrepancies: readonly ReconciliationDiscrepancy[]
} {
  const discrepancies: ReconciliationDiscrepancy[] = []
  const uniqueLedger = new Map<string, CashLedgerEntry>()
  for (const entry of input.ledgerEntries) {
    const current = uniqueLedger.get(entry.idempotencyKey)
    if (current !== undefined && current.id !== entry.id) {
      discrepancies.push({
        code: 'CASH_MISMATCH',
        key: entry.idempotencyKey,
        expected: current.id,
        actual: entry.id,
      })
    } else uniqueLedger.set(entry.idempotencyKey, entry)
  }
  const expectedCash = [...uniqueLedger.values()].reduce(
    (cash, entry) => cash.plus(decimal(entry.amountBase)),
    decimal(input.openingCashBase),
  )
  if (!expectedCash.eq(decimal(input.materializedCashBase))) {
    discrepancies.push({
      code: 'CASH_MISMATCH',
      key: 'account-cash',
      expected: decimalValue(expectedCash),
      actual: input.materializedCashBase,
    })
  }

  const rebuiltLots = rebuildLots(input.events)
  const actualLots = new Map(input.materializedLots.map((lot) => [lot.id, lot]))
  for (const expected of rebuiltLots) {
    const actual = actualLots.get(expected.id)
    const fields: readonly (keyof PositionLot)[] = [
      'remainingQuantity',
      'remainingOpenBaseNotional',
      'openingFeeRemainingBase',
      'openPrice',
    ]
    if (actual === undefined) {
      discrepancies.push({
        code: 'LOT_MISMATCH',
        key: expected.id,
        expected: 'present',
        actual: 'missing',
      })
      continue
    }
    for (const field of fields) {
      if (
        !decimal(expected[field] as DecimalValue).eq(
          decimal(actual[field] as DecimalValue),
        )
      ) {
        discrepancies.push({
          code: 'LOT_MISMATCH',
          key: `${expected.id}:${field}`,
          expected: expected[field] as string,
          actual: actual[field] as string,
        })
      }
    }
  }

  const expectedPositions = new Map(
    positionsFromLots(rebuiltLots).map((position) => [
      position.instrumentId,
      position,
    ]),
  )
  const actualPositions = new Map(
    input.materializedPositions.map((position) => [
      position.instrumentId,
      position,
    ]),
  )
  for (const instrumentId of new Set([
    ...expectedPositions.keys(),
    ...actualPositions.keys(),
  ])) {
    const expected = expectedPositions.get(instrumentId) ?? {
      instrumentId,
      side: 'flat' as const,
      quantity: '0',
    }
    const actual = actualPositions.get(instrumentId) ?? {
      instrumentId,
      side: 'flat' as const,
      quantity: '0',
    }
    if (
      expected.side !== actual.side ||
      !decimal(expected.quantity).eq(decimal(actual.quantity))
    ) {
      discrepancies.push({
        code: 'POSITION_MISMATCH',
        key: instrumentId,
        expected: `${expected.side}:${expected.quantity}`,
        actual: `${actual.side}:${actual.quantity}`,
      })
    }
  }

  for (const event of input.events) {
    if (event.kind !== 'fill') continue
    const entries = [...uniqueLedger.values()].filter(
      (entry) =>
        entry.sourceType === 'fill' && entry.sourceId === event.fill.id,
    )
    const actualDelta = entries.reduce(
      (sum, entry) => sum.plus(decimal(entry.amountBase)),
      decimal('0'),
    )
    const expectedDelta = decimal(cashDeltaForFill(event.fill))
    if (!actualDelta.eq(expectedDelta)) {
      discrepancies.push({
        code: 'FILL_LEDGER_MISMATCH',
        key: event.fill.id,
        expected: decimalValue(expectedDelta),
        actual: decimalValue(actualDelta),
      })
    }
  }

  return {
    ok: discrepancies.length === 0,
    expectedCashBase: decimalValue(expectedCash),
    discrepancies,
  }
}
