import { describe, expect, it } from 'vitest'

import { parseHostedDraftUpdateForm } from './update-hosted-draft'

const operationId = 'd2000000-0000-4000-8000-000000000001'
const experimentId = 'e2000000-0000-4000-8000-000000000001'

function form(
  values: Partial<
    Record<
      | 'operationId'
      | 'experimentId'
      | 'expectedRevision'
      | 'name'
      | 'objective',
      string
    >
  > = {},
) {
  const data = new FormData()
  data.set('operationId', values.operationId ?? operationId)
  data.set('experimentId', values.experimentId ?? experimentId)
  data.set('expectedRevision', values.expectedRevision ?? '9007199254740993')
  data.set('name', values.name ?? 'Hosted event study')
  data.set(
    'objective',
    values.objective ?? 'Evaluate a point-in-time event hypothesis safely.',
  )
  return data
}

describe('hosted draft update form parsing', () => {
  it('trims editable fields and preserves exact identifiers and revision text', () => {
    const result = parseHostedDraftUpdateForm(
      form({ name: '  Alpha lab  ', objective: '  Test a durable thesis.  ' }),
    )

    expect(result).toEqual({
      success: true,
      data: {
        operationId,
        experimentId,
        expectedRevision: '9007199254740993',
        name: 'Alpha lab',
        objective: 'Test a durable thesis.',
      },
    })
  })

  it.each([
    'E2000000-0000-7000-8000-000000000001',
    'E2000000-0000-8000-8000-000000000001',
  ])('accepts uppercase version 7 and 8 experiment identifiers', (value) => {
    const result = parseHostedDraftUpdateForm(form({ experimentId: value }))

    expect(result).toMatchObject({
      success: true,
      data: { experimentId: value },
    })
  })

  it.each([
    ['operationId', { operationId: 'not-a-uuid' }],
    ['experimentId', { experimentId: 'not-a-uuid' }],
    ['expectedRevision', { expectedRevision: '-1' }],
    ['expectedRevision', { expectedRevision: '02' }],
    ['expectedRevision', { expectedRevision: '9223372036854775808' }],
    ['name', { name: '  ' }],
    ['name', { name: 'x'.repeat(101) }],
    ['objective', { objective: 'short' }],
    ['objective', { objective: 'x'.repeat(1001) }],
  ] as const)('rejects an invalid %s', (field, values) => {
    const result = parseHostedDraftUpdateForm(form(values))

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.state.status).toBe('error')
      expect(result.state.fieldErrors?.[field]).toBeTruthy()
    }
  })
})
