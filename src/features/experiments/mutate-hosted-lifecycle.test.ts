import { describe, expect, it } from 'vitest'

import { parseHostedLifecycleForm } from './mutate-hosted-lifecycle'

const operationId = '11111111-1111-4111-8111-111111111111'
const experimentId = '22222222-2222-4222-8222-222222222222'
const lockedVersionId = '33333333-3333-4333-8333-333333333333'

function form(action: string, fields: Record<string, string> = {}): FormData {
  const result = new FormData()
  result.set('operationId', operationId)
  result.set('experimentId', experimentId)
  result.set('expectedControlStateVersion', '7')
  result.set('action', action)
  for (const [key, value] of Object.entries(fields)) result.set(key, value)
  return result
}

describe('parseHostedLifecycleForm', () => {
  it('normalizes a bounded pause reason', () => {
    expect(
      parseHostedLifecycleForm(form('pause', { reason: '  Owner review  ' })),
    ).toEqual({
      success: true,
      data: {
        operationId,
        experimentId,
        expectedControlStateVersion: '7',
        action: 'pause',
        reason: 'Owner review',
        confirmation: null,
        lockedVersionId: null,
        cloneName: null,
      },
    })
  })

  it('requires the exact locked snapshot confirmation for live-paper', () => {
    const invalid = parseHostedLifecycleForm(
      form('promote_live_paper', {
        confirmation: 'yes',
        lockedVersionId,
      }),
    )
    expect(invalid.success).toBe(false)
    if (!invalid.success) {
      expect(invalid.state.fieldErrors?.confirmation).toBe(
        'Enter PROMOTE TO LIVE PAPER exactly',
      )
    }

    expect(
      parseHostedLifecycleForm(
        form('promote_live_paper', {
          confirmation: 'PROMOTE TO LIVE PAPER',
          lockedVersionId,
        }),
      ),
    ).toMatchObject({
      success: true,
      data: {
        action: 'promote_live_paper',
        confirmation: 'PROMOTE TO LIVE PAPER',
        lockedVersionId,
      },
    })
  })

  it('accepts clone names only for clone operations', () => {
    expect(
      parseHostedLifecycleForm(
        form('clone', { cloneName: '  Next paper draft  ' }),
      ),
    ).toMatchObject({
      success: true,
      data: { action: 'clone', cloneName: 'Next paper draft' },
    })

    const invalid = parseHostedLifecycleForm(
      form('resume', { cloneName: 'Unexpected clone' }),
    )
    expect(invalid.success).toBe(false)
    if (!invalid.success) {
      expect(invalid.state.fieldErrors?.cloneName).toContain('not accepted')
    }
  })

  it('rejects malformed and overflowing control revisions', () => {
    const malformed = form('resume')
    malformed.set('expectedControlStateVersion', '07')
    expect(parseHostedLifecycleForm(malformed).success).toBe(false)

    const overflow = form('resume')
    overflow.set('expectedControlStateVersion', '9223372036854775808')
    expect(parseHostedLifecycleForm(overflow).success).toBe(false)
  })

  it('rejects action-specific extra inputs', () => {
    const invalid = parseHostedLifecycleForm(
      form('complete', { reason: 'Unexpected reason' }),
    )
    expect(invalid.success).toBe(false)
    if (!invalid.success) {
      expect(invalid.state.fieldErrors?.reason).toContain('not accepted')
    }
  })
})
