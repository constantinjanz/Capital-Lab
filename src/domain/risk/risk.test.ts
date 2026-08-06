import { describe, expect, it } from 'vitest'

import {
  automaticPauseReasons,
  checkPostTradeRisk,
  rankForcedLiquidations,
  sizeNewPosition,
  type RiskConfig,
} from './risk'

const config: RiskConfig = {
  maximumGrossLeverage: '2',
  maximumSingleNameFraction: '0.25',
  maximumNewRiskFraction: '0.05',
  stopDistanceFraction: '0.05',
  stopGapBufferFraction: '0.01',
  longInitialMarginFraction: '0.5',
  shortInitialMarginFraction: '0.5',
  dailyLossPauseFraction: '0.2',
  drawdownPauseFraction: '0.5',
}

describe('risk sizing', () => {
  it('sizes deterministically to the target and reports the stop', () => {
    const result = sizeNewPosition(
      {
        direction: 'long',
        navBase: '100000',
        targetExposureFraction: '0.2',
        currentInstrumentAbsExposureBase: '0',
        currentGrossExposureBase: '0',
        reservedGrossExposureBase: '0',
        currentInitialMarginBase: '0',
        reservedInitialMarginBase: '0',
        entryPriceBase: '100',
        estimatedRoundTripFeesPerUnitBase: '0',
        quantityIncrement: '1',
        priceTickBase: '0.01',
      },
      config,
    )
    expect(result).toMatchObject({
      accepted: true,
      quantity: '200',
      stopPriceBase: '95',
      plannedRiskBase: '1200',
    })
    expect(result.limitingConstraints).toEqual(['target'])
  })

  it('reserves borrow as a hard short cap', () => {
    const result = sizeNewPosition(
      {
        direction: 'short',
        navBase: '100000',
        targetExposureFraction: '0.1',
        currentInstrumentAbsExposureBase: '0',
        currentGrossExposureBase: '0',
        reservedGrossExposureBase: '0',
        currentInitialMarginBase: '0',
        reservedInitialMarginBase: '0',
        entryPriceBase: '100',
        estimatedRoundTripFeesPerUnitBase: '0',
        quantityIncrement: '1',
        priceTickBase: '0.01',
        borrowAvailableQuantity: '0',
      },
      config,
    )
    expect(result.accepted).toBe(false)
    expect(result.reasons).toContain('BORROW_UNAVAILABLE')
  })

  it('accepts exact limits and rejects one unit over', () => {
    expect(
      checkPostTradeRisk({
        navBase: '100000',
        postGrossExposureBase: '200000',
        postInstrumentAbsExposureBase: '25000',
        postInitialMarginBase: '100000',
        plannedNewRiskBase: '5000',
        config,
      }),
    ).toEqual([])
    expect(
      checkPostTradeRisk({
        navBase: '100000',
        postGrossExposureBase: '200000.01',
        postInstrumentAbsExposureBase: '25000.01',
        postInitialMarginBase: '100000.01',
        plannedNewRiskBase: '5000.01',
        config,
      }),
    ).toEqual([
      'GROSS_LEVERAGE_BREACH',
      'CONCENTRATION_BREACH',
      'TRADE_RISK_BREACH',
      'INITIAL_MARGIN_BREACH',
    ])
  })
})

describe('risk controls', () => {
  it('pauses at the configured daily loss and drawdown boundaries', () => {
    expect(
      automaticPauseReasons({
        currentNavBase: '80000',
        sessionOpeningNavBase: '100000',
        peakNavBase: '160000',
        config,
      }),
    ).toEqual(['DAILY_LOSS_LIMIT', 'DRAWDOWN_LIMIT'])
  })

  it('ranks forced liquidation by deterministic margin relief', () => {
    const ranked = rankForcedLiquidations([
      {
        instrumentId: 'B',
        quantity: '10',
        absMarketValueBase: '1000',
        initialMarginFraction: '0.5',
        maintenanceMarginFraction: '0.25',
      },
      {
        instrumentId: 'A',
        quantity: '10',
        absMarketValueBase: '1000',
        initialMarginFraction: '0.5',
        maintenanceMarginFraction: '0.4',
      },
    ])
    expect(ranked.map((position) => position.instrumentId)).toEqual(['A', 'B'])
  })
})
