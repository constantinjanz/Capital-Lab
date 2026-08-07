import { describe, expect, it } from 'vitest'

import { parseHostedDraftForm } from './create-hosted-draft'

const operationId = 'd1000000-0000-4000-8000-000000000001'

function form(
  values: Partial<Record<'operationId' | 'name' | 'objective', string>> = {},
) {
  const data = new FormData()
  data.set('operationId', values.operationId ?? operationId)
  data.set('name', values.name ?? 'Hosted event study')
  data.set(
    'objective',
    values.objective ?? 'Evaluate a point-in-time event hypothesis safely.',
  )
  return data
}

describe('hosted draft form parsing', () => {
  it('trims the editable fields and preserves the operation id', () => {
    const result = parseHostedDraftForm(
      form({ name: '  Alpha lab  ', objective: '  Test a durable thesis.  ' }),
    )

    expect(result).toEqual({
      success: true,
      data: {
        operationId,
        name: 'Alpha lab',
        objective: 'Test a durable thesis.',
      },
    })
  })

  it.each([
    ['operationId', { operationId: 'not-a-uuid' }],
    ['name', { name: '  ' }],
    ['name', { name: 'x'.repeat(101) }],
    ['objective', { objective: 'short' }],
    ['objective', { objective: 'x'.repeat(1001) }],
  ] as const)('rejects an invalid %s', (field, values) => {
    const result = parseHostedDraftForm(form(values))

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.state.status).toBe('error')
      expect(result.state.fieldErrors?.[field]).toBeTruthy()
    }
  })
})
