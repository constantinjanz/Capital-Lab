import { describe, expect, it } from 'vitest'

import { previewSourceRegistryImport } from './importers'

describe('source registry CSV preview', () => {
  it('parses allowlisted source metadata including quoted commas', () => {
    const rows = previewSourceRegistryImport(
      'source_id,name,canonical_url,source_type,licensing,retention_policy,enabled\nsec,"SEC, EDGAR",https://www.sec.gov,sec,public,metadata-only,true',
    )
    expect(rows).toEqual([
      expect.objectContaining({
        source_id: 'sec',
        name: 'SEC, EDGAR',
        enabled: true,
      }),
    ])
  })
})
