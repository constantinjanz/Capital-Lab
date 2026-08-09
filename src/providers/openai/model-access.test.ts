import { describe, expect, it, vi } from 'vitest'

import { checkRequiredOpenAIModelAccess } from './gateway'

describe('OpenAI model-list activation check', () => {
  it('does not perform a request without a configured runtime key', async () => {
    const listModels = vi.fn()
    await expect(
      checkRequiredOpenAIModelAccess(undefined, 10_000, { listModels }),
    ).resolves.toMatchObject({ status: 'not_configured' })
    expect(listModels).not.toHaveBeenCalled()
  })

  it('checks exact Luna, Terra, and Sol model IDs', async () => {
    const result = await checkRequiredOpenAIModelAccess('redacted', 10_000, {
      listModels: async () => ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol'],
    })
    expect(result).toEqual({
      status: 'ok',
      requiredModels: {
        'gpt-5.6-luna': true,
        'gpt-5.6-terra': true,
        'gpt-5.6-sol': true,
      },
    })
  })

  it.each([
    [401, 'authentication_error'],
    [403, 'permission_error'],
    [429, 'rate_limited'],
  ] as const)('redacts an HTTP %s failure as %s', async (status, expected) => {
    const result = await checkRequiredOpenAIModelAccess('redacted', 10_000, {
      listModels: async () => {
        throw Object.assign(new Error('sensitive provider message'), { status })
      },
    })
    expect(result.status).toBe(expected)
    expect(JSON.stringify(result)).not.toContain('sensitive')
    expect(JSON.stringify(result)).not.toContain('redacted')
  })
})
