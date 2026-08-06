import { describe, expect, it } from 'vitest'

import { applyFillToLots } from './lots'
import {
  reconcileAccount,
  type CashLedgerEntry,
  type RebuildEvent,
} from './reconciliation'
import type { AccountedFill, OrderSide } from './types'

function fill(
  id: string,
  side: OrderSide,
  quantity: string,
  baseNotional: string,
  fees: string,
): AccountedFill {
  return {
    id,
    orderId: `order:${id}`,
    instrumentId: 'AAPL',
    side,
    quantity,
    price: side === 'sell' ? '120' : '100',
    quoteNotional: baseNotional,
    currency: 'USD',
    fillAt:
      id === 'open' ? '2026-01-02T15:00:00.000Z' : '2026-01-02T16:00:00.000Z',
    observedAt:
      id === 'open' ? '2026-01-02T15:00:00.100Z' : '2026-01-02T16:00:00.100Z',
    marketDataIds: [`quote:${id}`],
    baseCurrency: 'EUR',
    quoteToBaseRate: '1',
    fxRateId: 'fx-1',
    baseNotional,
    commissionBase: fees,
    regulatoryFeeBase: '0',
    totalFeesBase: fees,
    idempotencyKey: `fill:${id}`,
  }
}

const open = fill('open', 'buy', '10', '1000', '2')
const close = fill('close', 'sell', '4', '480', '1')
const events: readonly RebuildEvent[] = [
  { kind: 'fill', occurredAt: open.fillAt, sequence: 1, fill: open },
  { kind: 'fill', occurredAt: close.fillAt, sequence: 1, fill: close },
]
const ledger: readonly CashLedgerEntry[] = [
  {
    id: 'l1',
    amountBase: '-1000',
    component: 'trade_principal',
    sourceType: 'fill',
    sourceId: 'open',
    occurredAt: open.fillAt,
    idempotencyKey: 'open:principal',
  },
  {
    id: 'l2',
    amountBase: '-2',
    component: 'commission',
    sourceType: 'fill',
    sourceId: 'open',
    occurredAt: open.fillAt,
    idempotencyKey: 'open:fee',
  },
  {
    id: 'l3',
    amountBase: '480',
    component: 'trade_principal',
    sourceType: 'fill',
    sourceId: 'close',
    occurredAt: close.fillAt,
    idempotencyKey: 'close:principal',
  },
  {
    id: 'l4',
    amountBase: '-1',
    component: 'commission',
    sourceType: 'fill',
    sourceId: 'close',
    occurredAt: close.fillAt,
    idempotencyKey: 'close:fee',
  },
]

describe('ledger and position reconciliation', () => {
  const opened = applyFillToLots([], open)
  const closed = applyFillToLots(opened.lots, close)

  it('rebuilds exact cash, lots, and positions', () => {
    const result = reconcileAccount({
      openingCashBase: '100000',
      ledgerEntries: ledger,
      events,
      materializedCashBase: '99477',
      materializedLots: closed.lots,
      materializedPositions: [
        { instrumentId: 'AAPL', side: 'long', quantity: '6' },
      ],
    })
    expect(result).toEqual({
      ok: true,
      expectedCashBase: '99477',
      discrepancies: [],
    })
  })

  it('detects projection corruption instead of tolerating it', () => {
    const result = reconcileAccount({
      openingCashBase: '100000',
      ledgerEntries: ledger,
      events,
      materializedCashBase: '99477.01',
      materializedLots: closed.lots,
      materializedPositions: [
        { instrumentId: 'AAPL', side: 'long', quantity: '7' },
      ],
    })
    expect(result.ok).toBe(false)
    expect(result.discrepancies.map((item) => item.code)).toEqual([
      'CASH_MISMATCH',
      'POSITION_MISMATCH',
    ])
  })

  it('detects a fill whose ledger components do not balance', () => {
    const result = reconcileAccount({
      openingCashBase: '100000',
      ledgerEntries: ledger.filter((entry) => entry.id !== 'l2'),
      events,
      materializedCashBase: '99479',
      materializedLots: closed.lots,
      materializedPositions: [
        { instrumentId: 'AAPL', side: 'long', quantity: '6' },
      ],
    })
    expect(result.discrepancies).toContainEqual({
      code: 'FILL_LEDGER_MISMATCH',
      key: 'open',
      expected: '-1002',
      actual: '-1000',
    })
  })
})
