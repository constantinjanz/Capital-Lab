import { describe, expect, it } from 'vitest'

import {
  ExperimentLifecycleError,
  cloneExperimentToDraft,
  completeExperiment,
  controlsForExperiment,
  createDraftExperiment,
  emergencyPauseExperiment,
  pauseExperiment,
  promoteShadowToLivePaper,
  resetExperimentInPlace,
  resumeExperiment,
  startExperiment,
  updateDraftConfiguration,
} from './lifecycle'
import type {
  Experiment,
  ExperimentConfiguration,
  StartArtifactIds,
  StartReadiness,
  TransitionArtifactIds,
} from './types'
import { validateExperimentConfiguration } from './validation'

const configuration: ExperimentConfiguration = {
  revision: 1,
  baseCurrency: 'EUR',
  initialCapital: '100000',
  objective: 'Maximize terminal net liquidation value',
  startAt: '2026-01-02T14:30:00.000Z',
  endAt: '2026-03-31T20:00:00.000Z',
  regularHoursOnly: true,
  longEnabled: true,
  shortEnabled: true,
  versions: {
    marketUniverseVersionId: 'universe-v1',
    simulatorConfigVersionId: 'simulator-v1',
    riskConfigVersionId: 'risk-v1',
    agentPromptVersionId: 'prompt-v1',
    modelRoutingVersionId: 'routing-v1',
    knowledgeCorpusVersionId: 'corpus-v1',
    dataSourceConfigVersionId: 'sources-v1',
    budgetPolicyVersionId: 'budget-v1',
    marketCalendarVersionId: 'calendar-v1',
  },
}

const readiness: StartReadiness = {
  dataProviderReady: true,
  marketCalendarReady: true,
  simulatorConfigValid: true,
  riskConfigValid: true,
  budgetPolicyValid: true,
  paperExecutionServiceReady: true,
  brokerTradingIntegrationPresent: false,
}

const startIds: StartArtifactIds = {
  configurationSnapshotId: 'snapshot-1',
  startingCashId: 'cash-1',
  initialPortfolioId: 'portfolio-1',
  statusEventId: 'status-1',
  auditRecordId: 'audit-1',
}

function ids(suffix: string): TransitionArtifactIds {
  return { statusEventId: `status-${suffix}`, auditRecordId: `audit-${suffix}` }
}

function draft(): Experiment {
  return createDraftExperiment({
    id: 'experiment-1',
    ownerId: 'owner-1',
    name: 'Capital Lab test',
    configuration,
  })
}

function start(mode: 'replay' | 'shadow' = 'shadow') {
  return startExperiment(draft(), {
    mode,
    operationId: 'operation-start',
    actorId: 'owner-1',
    occurredAt: '2026-01-02T14:00:00.000Z',
    readiness,
    artifactIds: startIds,
  })
}

function expectLifecycleError(
  action: () => unknown,
  code: ExperimentLifecycleError['code'],
): void {
  try {
    action()
    throw new Error('Expected lifecycle operation to fail')
  } catch (error) {
    expect(error).toBeInstanceOf(ExperimentLifecycleError)
    expect((error as ExperimentLifecycleError).code).toBe(code)
  }
}

describe('experiment configuration and start', () => {
  it('validates financial, temporal, and versioned configuration', () => {
    expect(validateExperimentConfiguration(configuration)).toEqual([])
    expect(
      validateExperimentConfiguration({
        ...configuration,
        initialCapital: '0',
        endAt: configuration.startAt,
        versions: { ...configuration.versions, riskConfigVersionId: '' },
      }),
    ).toEqual([
      { code: 'INVALID_INITIAL_CAPITAL', field: 'initialCapital' },
      { code: 'INVALID_TIME_RANGE', field: 'startAt/endAt' },
      {
        code: 'MISSING_VERSION_REFERENCE',
        field: 'versions.riskConfigVersionId',
      },
    ])
  })

  it('locks an immutable snapshot and emits deterministic starting artifacts', () => {
    const result = start('replay')
    expect(result.changed).toBe(true)
    expect(result.experiment).toMatchObject({
      lifecycle: 'replay',
      lockedAt: '2026-01-02T14:00:00.000Z',
    })
    expect(Object.isFrozen(result.experiment.configurationSnapshot)).toBe(true)
    expect(
      Object.isFrozen(result.experiment.configurationSnapshot?.configuration),
    ).toBe(true)
    expect(
      Object.isFrozen(
        result.experiment.configurationSnapshot?.configuration.versions,
      ),
    ).toBe(true)
    expect(result.artifacts.startingCash).toEqual({
      id: 'cash-1',
      experimentId: 'experiment-1',
      currency: 'EUR',
      amount: '100000',
      component: 'starting_capital',
      occurredAt: '2026-01-02T14:00:00.000Z',
      idempotencyKey: 'experiment:experiment-1:starting-cash',
    })
    expect(result.artifacts.initialPortfolio).toMatchObject({
      cash: '100000',
      netLiquidationValue: '100000',
      realizedPnl: '0',
      unrealizedPnl: '0',
      grossExposure: '0',
      netExposure: '0',
    })
    expect(result.artifacts.auditRecords[0]?.metadata).toEqual({
      mode: 'replay',
      configurationSnapshotId: 'snapshot-1',
      paperTradingOnly: true,
    })
  })

  it('rejects unsafe readiness and makes a retried start idempotent', () => {
    expectLifecycleError(
      () =>
        startExperiment(draft(), {
          mode: 'shadow',
          operationId: 'unsafe-start',
          actorId: 'owner-1',
          occurredAt: '2026-01-02T14:00:00.000Z',
          readiness: { ...readiness, brokerTradingIntegrationPresent: true },
          artifactIds: startIds,
        }),
      'START_NOT_READY',
    )
    const started = start()
    const retry = startExperiment(started.experiment, {
      mode: 'shadow',
      operationId: 'operation-start',
      actorId: 'owner-1',
      occurredAt: '2026-01-02T14:00:00.000Z',
      readiness,
      artifactIds: startIds,
    })
    expect(retry).toEqual({
      changed: false,
      experiment: started.experiment,
      artifacts: { statusEvents: [], auditRecords: [] },
    })
  })

  it('prohibits configuration edits after start', () => {
    expectLifecycleError(
      () =>
        updateDraftConfiguration(start().experiment, {
          ...configuration,
          revision: 2,
        }),
      'CONFIGURATION_LOCKED',
    )
  })
})

describe('controlled lifecycle transitions', () => {
  it('requires exact owner confirmation of the locked snapshot for live-paper', () => {
    const shadow = start().experiment
    expectLifecycleError(
      () =>
        promoteShadowToLivePaper(shadow, {
          operationId: 'promote-1',
          actorId: 'owner-1',
          occurredAt: '2026-01-03T14:00:00.000Z',
          confirmation: {
            confirmed: true,
            phrase: 'yes',
            ownerId: 'owner-1',
            configurationSnapshotId: 'snapshot-1',
          },
          artifactIds: ids('promote'),
        }),
      'EXPLICIT_CONFIRMATION_REQUIRED',
    )
    const promoted = promoteShadowToLivePaper(shadow, {
      operationId: 'promote-2',
      actorId: 'owner-1',
      occurredAt: '2026-01-03T14:00:00.000Z',
      confirmation: {
        confirmed: true,
        phrase: 'PROMOTE TO LIVE PAPER',
        ownerId: 'owner-1',
        configurationSnapshotId: 'snapshot-1',
      },
      artifactIds: ids('promote-2'),
    })
    expect(promoted.experiment.lifecycle).toBe('live_paper')
    expect(promoted.artifacts.auditRecords[0]?.action).toBe(
      'experiment.promoted_live_paper',
    )
  })

  it('pauses, restores the exact prior mode, then completes', () => {
    const replay = start('replay').experiment
    const paused = pauseExperiment(replay, {
      operationId: 'pause-1',
      actorId: 'owner-1',
      occurredAt: '2026-01-03T15:00:00.000Z',
      reason: 'operator review',
      artifactIds: ids('pause'),
    })
    expect(paused.experiment).toMatchObject({
      lifecycle: 'paused',
      resumeState: 'replay',
      pauseReason: 'operator review',
    })
    expect(controlsForExperiment(paused.experiment)).toEqual({
      agentCallsAllowed: false,
      simulatedOrdersAllowed: false,
      proposalOnly: false,
      dataIngestionAllowed: true,
    })
    const resumed = resumeExperiment(paused.experiment, {
      operationId: 'resume-1',
      actorId: 'owner-1',
      occurredAt: '2026-01-03T16:00:00.000Z',
      artifactIds: ids('resume'),
    })
    expect(resumed.experiment.lifecycle).toBe('replay')
    const completed = completeExperiment(resumed.experiment, {
      operationId: 'complete-1',
      actorId: 'owner-1',
      occurredAt: '2026-03-31T20:00:00.000Z',
      artifactIds: ids('complete'),
    })
    expect(completed.experiment).toMatchObject({
      lifecycle: 'completed',
      completedAt: '2026-03-31T20:00:00.000Z',
    })
  })

  it('makes emergency pause idempotent without overwriting the first reason', () => {
    const active = start().experiment
    const first = emergencyPauseExperiment(active, {
      operationId: 'emergency-1',
      actorId: 'system',
      occurredAt: '2026-01-03T17:00:00.000Z',
      reason: 'LEDGER_CORRUPT',
      artifactIds: ids('emergency-1'),
    })
    const duplicate = emergencyPauseExperiment(first.experiment, {
      operationId: 'emergency-2',
      actorId: 'system',
      occurredAt: '2026-01-03T17:00:01.000Z',
      reason: 'different reason',
      artifactIds: ids('emergency-2'),
    })
    expect(first.experiment.pauseReason).toBe('LEDGER_CORRUPT')
    expect(duplicate.changed).toBe(false)
    expect(duplicate.experiment).toBe(first.experiment)
    expect(duplicate.artifacts).toEqual({ statusEvents: [], auditRecords: [] })
  })
})

describe('reset and clone policy', () => {
  it('always prohibits in-place reset', () => {
    expectLifecycleError(
      () => resetExperimentInPlace(start().experiment),
      'IN_PLACE_RESET_PROHIBITED',
    )
  })

  it('clones locked rules into a distinct editable draft without changing the source', () => {
    const source = start().experiment
    const cloned = cloneExperimentToDraft(source, {
      newExperimentId: 'experiment-2',
      newName: 'Cloned experiment',
      operationId: 'clone-1',
      actorId: 'owner-1',
      occurredAt: '2026-04-01T12:00:00.000Z',
      auditRecordId: 'audit-clone',
    })
    expect(source.lifecycle).toBe('shadow')
    expect(cloned.experiment).toMatchObject({
      id: 'experiment-2',
      lifecycle: 'draft',
      sourceExperimentId: 'experiment-1',
    })
    expect(cloned.experiment.lockedAt).toBeUndefined()
    expect(cloned.experiment.configurationSnapshot).toBeUndefined()
    expect(cloned.experiment.draftConfiguration).toEqual(
      source.configurationSnapshot?.configuration,
    )
    expect(cloned.experiment.draftConfiguration).not.toBe(
      source.configurationSnapshot?.configuration,
    )
    expect(
      updateDraftConfiguration(cloned.experiment, {
        ...cloned.experiment.draftConfiguration,
        revision: 2,
      }).draftConfiguration.revision,
    ).toBe(2)
  })

  it('rejects cloning to the same experiment ID', () => {
    expectLifecycleError(
      () =>
        cloneExperimentToDraft(start().experiment, {
          newExperimentId: 'experiment-1',
          newName: 'Not a clone',
          operationId: 'clone-bad',
          actorId: 'owner-1',
          occurredAt: '2026-04-01T12:00:00.000Z',
          auditRecordId: 'audit-clone-bad',
        }),
      'IN_PLACE_RESET_PROHIBITED',
    )
  })
})
