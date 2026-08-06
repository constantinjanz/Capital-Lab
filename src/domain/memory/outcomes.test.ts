import { describe, expect, it } from 'vitest'

import { labelDecisionOutcome } from './outcomes'

describe('decision outcome labels', () => {
  it('labels exact forward, benchmark-relative, MFE, and MAE values', () => {
    expect(
      labelDecisionOutcome({
        direction: 'long',
        horizon: '1_hour',
        entryInstrumentPrice: '100',
        entryBenchmarkPrice: '200',
        decisionAt: '2026-08-06T14:00:00.000Z',
        path: [
          {
            at: '2026-08-06T14:15:00.000Z',
            instrumentPrice: '98',
            benchmarkPrice: '201',
          },
          {
            at: '2026-08-06T15:00:00.000Z',
            instrumentPrice: '105',
            benchmarkPrice: '202',
          },
        ],
      }),
    ).toMatchObject({
      forwardReturn: '0.05',
      benchmarkRelativeReturn: '0.04',
      maximumFavorableExcursion: '0.05',
      maximumAdverseExcursion: '-0.02',
    })
  })

  it('rejects lookahead-contaminated outcome paths', () => {
    expect(() =>
      labelDecisionOutcome({
        direction: 'short',
        horizon: '15_minutes',
        entryInstrumentPrice: '100',
        entryBenchmarkPrice: '100',
        decisionAt: '2026-08-06T14:00:00.000Z',
        path: [
          {
            at: '2026-08-06T14:00:00.000Z',
            instrumentPrice: '99',
            benchmarkPrice: '100',
          },
        ],
      }),
    ).toThrow('strictly after')
  })
})
