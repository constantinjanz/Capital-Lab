import { describe, expect, it } from 'vitest'

import {
  mapHostedMarketConfigurationResult,
  parseHostedMarketConfigurationForm,
} from './configure-hosted-market'

const operationId = 'd3000000-0000-4000-8000-000000000001'
const universeId = 'a3000000-0000-4000-8000-000000000001'
const sourceId = 'b3000000-0000-4000-8000-000000000001'

function form(value: FormDataEntryValue | null = operationId) {
  const data = new FormData()
  if (value !== null) data.set('operationId', value)
  return data
}

describe('hosted market configuration validation', () => {
  it('accepts only the operation identifier from the form', () => {
    const data = form()
    data.set('ownerId', '00000000-0000-4000-8000-000000000999')
    data.set('sourceEnabled', 'true')
    data.set('symbols', 'GME')

    expect(parseHostedMarketConfigurationForm(data)).toEqual({
      success: true,
      data: { operationId },
    })
  })

  it.each([null, 'not-a-uuid'])('rejects an invalid operation id', (value) => {
    const parsed = parseHostedMarketConfigurationForm(form(value))

    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.state).toMatchObject({
        status: 'error',
        fieldErrors: { operationId: expect.any(String) },
      })
    }
  })

  it('maps exactly one matching configured result', () => {
    expect(
      mapHostedMarketConfigurationResult(
        [
          {
            operation_id: operationId,
            status: 'configured',
            universe_id: universeId,
            source_id: sourceId,
            replayed: false,
          },
        ],
        operationId,
      ),
    ).toEqual({
      operationId,
      universeId,
      sourceId,
      replayed: false,
    })
  })

  it.each([
    null,
    [],
    [
      {
        operation_id: operationId,
        status: 'configured',
        universe_id: universeId,
        source_id: sourceId,
        replayed: false,
      },
      {
        operation_id: operationId,
        status: 'configured',
        universe_id: universeId,
        source_id: sourceId,
        replayed: true,
      },
    ],
    [
      {
        operation_id: 'd3000000-0000-4000-8000-000000000999',
        status: 'configured',
        universe_id: universeId,
        source_id: sourceId,
        replayed: false,
      },
    ],
    [
      {
        operation_id: operationId,
        status: 'enabled',
        universe_id: universeId,
        source_id: sourceId,
        replayed: false,
      },
    ],
    [
      {
        operation_id: operationId,
        status: 'configured',
        universe_id: universeId,
        source_id: sourceId,
        replayed: false,
        credentials: 'must-not-be-returned',
      },
    ],
  ])('rejects malformed, ambiguous, or mismatched RPC data', (data) => {
    expect(mapHostedMarketConfigurationResult(data, operationId)).toBeNull()
  })
})
