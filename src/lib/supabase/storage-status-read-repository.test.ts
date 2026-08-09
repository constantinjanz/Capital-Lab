import { describe, expect, it } from 'vitest'

import { mapHostedStorageStatus } from './storage-status-read-repository'

describe('hosted storage status mapping', () => {
  it('maps exact byte strings and threshold forecasts', () => {
    expect(
      mapHostedStorageStatus({
        available: true,
        captured_at: '2026-08-09T12:00:00.000Z',
        database_bytes: '26127507',
        limit_bytes: '524288000',
        utilization_percent: '4.9834',
        threshold_state: 'normal',
        largest_relations: [
          {
            schema: 'public',
            relation: 'market_sessions',
            total_bytes: '581632',
          },
        ],
        growth_7_bytes: '0',
        growth_30_bytes: '0',
        forecast_days: {
          warning_60: null,
          archive_75: null,
          block_raw_85: null,
          pause_90: null,
        },
        last_cleanup_at: null,
        last_cleanup_count: 0,
      }),
    ).toMatchObject({
      available: true,
      databaseBytes: '26127507',
      thresholdState: 'normal',
    })
  })

  it('rejects number-coerced byte values', () => {
    expect(() =>
      mapHostedStorageStatus({
        available: true,
        captured_at: '2026-08-09T12:00:00.000Z',
        database_bytes: 26127507,
        limit_bytes: '524288000',
        utilization_percent: '4.9834',
        threshold_state: 'normal',
        largest_relations: [],
        growth_7_bytes: '0',
        growth_30_bytes: '0',
        forecast_days: {
          warning_60: null,
          archive_75: null,
          block_raw_85: null,
          pause_90: null,
        },
        last_cleanup_at: null,
        last_cleanup_count: 0,
      }),
    ).toThrow('text is invalid')
  })
})
