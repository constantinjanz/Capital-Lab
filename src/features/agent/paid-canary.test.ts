import { describe, expect, it, vi } from 'vitest'

import type { OpenAIGateway } from '@/providers/openai/types'

import { runPaidOpenAICanary, type PaidCanaryBudgetLedger } from './paid-canary'

function dependencies() {
  const runPaidCanary = vi.fn(async ({ model }: { model: string }) => ({
    responseId: `response-${model}`,
    outputText: 'OK',
    usage: {
      inputTokens: '8',
      cachedInputTokens: '0',
      cacheWriteTokens: '0',
      outputTokens: '1',
      webSearchCalls: '0',
    },
    providerInputTokens: '8',
    reasoningTokens: '0',
    latencyMs: 1,
    finishState: 'completed' as const,
  }))
  const gateway = {
    runPaidCanary,
  } as unknown as OpenAIGateway
  const ledger: PaidCanaryBudgetLedger = {
    reserve: vi.fn(async ({ model }) => ({
      accepted: true as const,
      reservation: {
        reservationId: `reservation-${model}`,
        reservedUsd: '0.002',
      },
    })),
    settle: vi.fn(async () => undefined),
    markUnknown: vi.fn(async () => undefined),
    release: vi.fn(async () => undefined),
  }
  return { gateway, ledger, runPaidCanary }
}

const safeConfiguration = {
  agentEnabled: false,
  autonomousPaperExecutionEnabled: false,
  paidModelCallsEnabled: true,
  canaryEnabled: true,
  webSearchEnabled: false,
  previewLike: false,
}

describe('local paid OpenAI canary', () => {
  it('makes exactly zero calls without the flag or exact confirmation', async () => {
    for (const [configuration, confirmation] of [
      [{ ...safeConfiguration, canaryEnabled: false }, 'MAX_0_01_USD'],
      [safeConfiguration, 'wrong'],
    ] as const) {
      const test = dependencies()
      const outcome = await runPaidOpenAICanary({
        confirmation,
        operationId: 'operation',
        configuration,
        gateway: test.gateway,
        ledger: test.ledger,
        acquireOneShotLock: vi.fn(async () => true),
      })
      expect(outcome.calls).toBe(0)
      expect(test.runPaidCanary).not.toHaveBeenCalled()
    }
  })

  it('calls Luna, Terra, and Sol once and reserves no more than one cent', async () => {
    const test = dependencies()
    const outcome = await runPaidOpenAICanary({
      confirmation: 'MAX_0_01_USD',
      operationId: 'operation',
      configuration: safeConfiguration,
      gateway: test.gateway,
      ledger: test.ledger,
      acquireOneShotLock: vi.fn(async () => true),
    })
    expect(outcome).toMatchObject({ status: 'completed', calls: 3 })
    expect(Number(outcome.reservedUsd)).toBeLessThanOrEqual(0.01)
    expect(
      test.runPaidCanary.mock.calls.map(([request]) => request.model),
    ).toEqual(['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol'])
  })

  it('stops after a Luna authentication failure and preserves unknown cost', async () => {
    const test = dependencies()
    test.runPaidCanary.mockRejectedValueOnce(
      Object.assign(new Error('redacted'), { status: 401 }),
    )
    const outcome = await runPaidOpenAICanary({
      confirmation: 'MAX_0_01_USD',
      operationId: 'operation',
      configuration: safeConfiguration,
      gateway: test.gateway,
      ledger: test.ledger,
      acquireOneShotLock: vi.fn(async () => true),
    })
    expect(outcome).toMatchObject({
      status: 'stopped',
      calls: 1,
      reason: 'luna_auth_billing_or_quota_failure',
    })
    expect(test.ledger.markUnknown).toHaveBeenCalledTimes(1)
    expect(test.ledger.release).toHaveBeenCalledTimes(2)
  })
})
