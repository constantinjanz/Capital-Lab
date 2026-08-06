import type {
  ActiveExperimentState,
  Experiment,
  ExperimentAuditRecord,
  ExperimentConfiguration,
  ExperimentConfigurationSnapshot,
  ExperimentControls,
  ExperimentLifecycleState,
  ExperimentStatusEvent,
  LifecycleArtifacts,
  LifecycleResult,
  StartArtifactIds,
  StartReadiness,
  TransitionArtifactIds,
} from './types'
import {
  validateExperimentConfiguration,
  validateStartReadiness,
} from './validation'

export type LifecycleErrorCode =
  | 'INVALID_CONFIGURATION'
  | 'START_NOT_READY'
  | 'INVALID_TRANSITION'
  | 'CONFIGURATION_LOCKED'
  | 'EXPLICIT_CONFIRMATION_REQUIRED'
  | 'OWNER_CONFIRMATION_REQUIRED'
  | 'SNAPSHOT_CONFIRMATION_MISMATCH'
  | 'IN_PLACE_RESET_PROHIBITED'
  | 'INVALID_COMMAND'

export class ExperimentLifecycleError extends Error {
  constructor(
    readonly code: LifecycleErrorCode,
    message: string,
    readonly details: readonly string[] = [],
  ) {
    super(message)
    this.name = 'ExperimentLifecycleError'
  }
}

const EMPTY_ARTIFACTS: LifecycleArtifacts = Object.freeze({
  statusEvents: [],
  auditRecords: [],
})
const LIVE_PAPER_CONFIRMATION = 'PROMOTE TO LIVE PAPER'

function requireText(value: string, name: string): void {
  if (value.trim().length === 0)
    throw new ExperimentLifecycleError('INVALID_COMMAND', `${name} is required`)
}

function requireTimestamp(value: string, name: string): void {
  if (!Number.isFinite(Date.parse(value))) {
    throw new ExperimentLifecycleError(
      'INVALID_COMMAND',
      `${name} must be a valid timestamp`,
    )
  }
}

function hasOperation(experiment: Experiment, operationId: string): boolean {
  return experiment.appliedOperationIds.includes(operationId)
}

function unchanged(experiment: Experiment): LifecycleResult {
  return { changed: false, experiment, artifacts: EMPTY_ARTIFACTS }
}

function withOperation(
  experiment: Experiment,
  operationId: string,
): Experiment {
  return {
    ...experiment,
    appliedOperationIds: [...experiment.appliedOperationIds, operationId],
  }
}

function copyConfiguration(
  configuration: ExperimentConfiguration,
): ExperimentConfiguration {
  return {
    ...configuration,
    versions: { ...configuration.versions },
  }
}

function deepFreezeConfiguration(
  configuration: ExperimentConfiguration,
): ExperimentConfiguration {
  Object.freeze(configuration.versions)
  return Object.freeze(configuration)
}

function statusEvent(input: {
  id: string
  experimentId: string
  from: ExperimentLifecycleState
  to: ExperimentLifecycleState
  occurredAt: string
  reason?: string
  operationId: string
}): ExperimentStatusEvent {
  return {
    id: input.id,
    experimentId: input.experimentId,
    from: input.from,
    to: input.to,
    occurredAt: input.occurredAt,
    ...(input.reason === undefined ? {} : { reason: input.reason }),
    operationId: input.operationId,
    idempotencyKey: `experiment:${input.experimentId}:status:${input.operationId}`,
  }
}

function auditRecord(input: {
  id: string
  experiment: Experiment
  actorId: string
  action: ExperimentAuditRecord['action']
  occurredAt: string
  operationId: string
  metadata?: Readonly<Record<string, string | boolean>>
}): ExperimentAuditRecord {
  return {
    id: input.id,
    experimentId: input.experiment.id,
    actorId: input.actorId,
    action: input.action,
    occurredAt: input.occurredAt,
    operationId: input.operationId,
    idempotencyKey: `experiment:${input.experiment.id}:audit:${input.operationId}`,
    metadata: input.metadata ?? {},
  }
}

function validateCommonCommand(input: {
  operationId: string
  actorId: string
  occurredAt: string
  artifactIds: TransitionArtifactIds
}): void {
  requireText(input.operationId, 'operationId')
  requireText(input.actorId, 'actorId')
  requireText(input.artifactIds.statusEventId, 'statusEventId')
  requireText(input.artifactIds.auditRecordId, 'auditRecordId')
  requireTimestamp(input.occurredAt, 'occurredAt')
}

export function createDraftExperiment(input: {
  id: string
  ownerId: string
  name: string
  configuration: ExperimentConfiguration
}): Experiment {
  requireText(input.id, 'id')
  requireText(input.ownerId, 'ownerId')
  requireText(input.name, 'name')
  const issues = validateExperimentConfiguration(input.configuration)
  if (issues.length > 0) {
    throw new ExperimentLifecycleError(
      'INVALID_CONFIGURATION',
      'Experiment configuration is invalid',
      issues.map((issue) => `${issue.code}:${issue.field}`),
    )
  }
  return {
    id: input.id,
    ownerId: input.ownerId,
    name: input.name,
    lifecycle: 'draft',
    draftConfiguration: copyConfiguration(input.configuration),
    appliedOperationIds: [],
  }
}

export function updateDraftConfiguration(
  experiment: Experiment,
  configuration: ExperimentConfiguration,
): Experiment {
  if (experiment.lifecycle !== 'draft' || experiment.lockedAt !== undefined) {
    throw new ExperimentLifecycleError(
      'CONFIGURATION_LOCKED',
      'Started experiment rules are immutable',
    )
  }
  const issues = validateExperimentConfiguration(configuration)
  if (issues.length > 0) {
    throw new ExperimentLifecycleError(
      'INVALID_CONFIGURATION',
      'Experiment configuration is invalid',
      issues.map((issue) => `${issue.code}:${issue.field}`),
    )
  }
  return { ...experiment, draftConfiguration: copyConfiguration(configuration) }
}

export function startExperiment(
  experiment: Experiment,
  command: {
    mode: 'replay' | 'shadow'
    operationId: string
    actorId: string
    occurredAt: string
    readiness: StartReadiness
    artifactIds: StartArtifactIds
  },
): LifecycleResult {
  validateCommonCommand(command)
  requireText(
    command.artifactIds.configurationSnapshotId,
    'configurationSnapshotId',
  )
  requireText(command.artifactIds.startingCashId, 'startingCashId')
  requireText(command.artifactIds.initialPortfolioId, 'initialPortfolioId')
  if (hasOperation(experiment, command.operationId))
    return unchanged(experiment)
  if (command.mode !== 'replay' && command.mode !== 'shadow') {
    throw new ExperimentLifecycleError(
      'INVALID_TRANSITION',
      'A draft may start only in replay or shadow mode',
    )
  }
  if (experiment.lifecycle !== 'draft' || experiment.lockedAt !== undefined) {
    throw new ExperimentLifecycleError(
      'INVALID_TRANSITION',
      'Only a draft may start replay or shadow mode',
    )
  }
  const configurationIssues = validateExperimentConfiguration(
    experiment.draftConfiguration,
  )
  if (configurationIssues.length > 0) {
    throw new ExperimentLifecycleError(
      'INVALID_CONFIGURATION',
      'Experiment configuration is invalid',
      configurationIssues.map((issue) => `${issue.code}:${issue.field}`),
    )
  }
  const readinessIssues = validateStartReadiness(command.readiness)
  if (readinessIssues.length > 0) {
    throw new ExperimentLifecycleError(
      'START_NOT_READY',
      'Experiment start checks failed',
      readinessIssues,
    )
  }

  const configuration = deepFreezeConfiguration(
    copyConfiguration(experiment.draftConfiguration),
  )
  const snapshot: ExperimentConfigurationSnapshot = Object.freeze({
    id: command.artifactIds.configurationSnapshotId,
    experimentId: experiment.id,
    lockedAt: command.occurredAt,
    configuration,
  })
  const started = withOperation(
    {
      ...experiment,
      lifecycle: command.mode,
      configurationSnapshot: snapshot,
      lockedAt: command.occurredAt,
    },
    command.operationId,
  )
  const event = statusEvent({
    id: command.artifactIds.statusEventId,
    experimentId: experiment.id,
    from: 'draft',
    to: command.mode,
    occurredAt: command.occurredAt,
    operationId: command.operationId,
  })
  const audit = auditRecord({
    id: command.artifactIds.auditRecordId,
    experiment: started,
    actorId: command.actorId,
    action: 'experiment.started',
    occurredAt: command.occurredAt,
    operationId: command.operationId,
    metadata: {
      mode: command.mode,
      configurationSnapshotId: snapshot.id,
      paperTradingOnly: true,
    },
  })
  return {
    changed: true,
    experiment: started,
    artifacts: {
      statusEvents: [event],
      auditRecords: [audit],
      startingCash: {
        id: command.artifactIds.startingCashId,
        experimentId: experiment.id,
        currency: configuration.baseCurrency,
        amount: configuration.initialCapital,
        component: 'starting_capital',
        occurredAt: command.occurredAt,
        idempotencyKey: `experiment:${experiment.id}:starting-cash`,
      },
      initialPortfolio: {
        id: command.artifactIds.initialPortfolioId,
        experimentId: experiment.id,
        currency: configuration.baseCurrency,
        cash: configuration.initialCapital,
        netLiquidationValue: configuration.initialCapital,
        realizedPnl: '0',
        unrealizedPnl: '0',
        grossExposure: '0',
        netExposure: '0',
        recordedAt: command.occurredAt,
        idempotencyKey: `experiment:${experiment.id}:initial-portfolio`,
      },
    },
  }
}

export function promoteShadowToLivePaper(
  experiment: Experiment,
  command: {
    operationId: string
    actorId: string
    occurredAt: string
    confirmation: {
      confirmed: boolean
      phrase: string
      ownerId: string
      configurationSnapshotId: string
    }
    artifactIds: TransitionArtifactIds
  },
): LifecycleResult {
  validateCommonCommand(command)
  if (hasOperation(experiment, command.operationId))
    return unchanged(experiment)
  if (experiment.lifecycle !== 'shadow') {
    throw new ExperimentLifecycleError(
      'INVALID_TRANSITION',
      'Only shadow mode may promote to live-paper',
    )
  }
  if (
    !command.confirmation.confirmed ||
    command.confirmation.phrase !== LIVE_PAPER_CONFIRMATION
  ) {
    throw new ExperimentLifecycleError(
      'EXPLICIT_CONFIRMATION_REQUIRED',
      `Confirmation phrase must be exactly ${LIVE_PAPER_CONFIRMATION}`,
    )
  }
  if (
    command.actorId !== experiment.ownerId ||
    command.confirmation.ownerId !== experiment.ownerId
  ) {
    throw new ExperimentLifecycleError(
      'OWNER_CONFIRMATION_REQUIRED',
      'Only the owner may confirm live-paper mode',
    )
  }
  if (
    experiment.configurationSnapshot === undefined ||
    command.confirmation.configurationSnapshotId !==
      experiment.configurationSnapshot.id
  ) {
    throw new ExperimentLifecycleError(
      'SNAPSHOT_CONFIRMATION_MISMATCH',
      'Confirmation must identify the locked configuration snapshot',
    )
  }
  return simpleTransition(experiment, {
    ...command,
    to: 'live_paper',
    action: 'experiment.promoted_live_paper',
    metadata: {
      configurationSnapshotId: experiment.configurationSnapshot.id,
      explicitOwnerConfirmation: true,
    },
  })
}

function simpleTransition(
  experiment: Experiment,
  command: {
    operationId: string
    actorId: string
    occurredAt: string
    artifactIds: TransitionArtifactIds
    to: ExperimentLifecycleState
    action: ExperimentAuditRecord['action']
    reason?: string
    metadata?: Readonly<Record<string, string | boolean>>
    resumeState?: ActiveExperimentState
  },
): LifecycleResult {
  const from = experiment.lifecycle
  const transitioned = withOperation(
    {
      ...experiment,
      lifecycle: command.to,
      ...(command.resumeState === undefined
        ? { resumeState: undefined }
        : { resumeState: command.resumeState }),
      ...(command.reason === undefined
        ? { pauseReason: undefined }
        : { pauseReason: command.reason }),
      ...(command.to === 'completed'
        ? { completedAt: command.occurredAt }
        : {}),
    },
    command.operationId,
  )
  return {
    changed: true,
    experiment: transitioned,
    artifacts: {
      statusEvents: [
        statusEvent({
          id: command.artifactIds.statusEventId,
          experimentId: experiment.id,
          from,
          to: command.to,
          occurredAt: command.occurredAt,
          reason: command.reason,
          operationId: command.operationId,
        }),
      ],
      auditRecords: [
        auditRecord({
          id: command.artifactIds.auditRecordId,
          experiment: transitioned,
          actorId: command.actorId,
          action: command.action,
          occurredAt: command.occurredAt,
          operationId: command.operationId,
          metadata: command.metadata,
        }),
      ],
    },
  }
}

export function pauseExperiment(
  experiment: Experiment,
  command: {
    operationId: string
    actorId: string
    occurredAt: string
    reason: string
    artifactIds: TransitionArtifactIds
  },
): LifecycleResult {
  validateCommonCommand(command)
  requireText(command.reason, 'reason')
  if (hasOperation(experiment, command.operationId))
    return unchanged(experiment)
  if (!isActive(experiment.lifecycle)) {
    throw new ExperimentLifecycleError(
      'INVALID_TRANSITION',
      'Only an active experiment may be paused',
    )
  }
  return simpleTransition(experiment, {
    ...command,
    to: 'paused',
    action: 'experiment.paused',
    resumeState: experiment.lifecycle,
  })
}

export function emergencyPauseExperiment(
  experiment: Experiment,
  command: {
    operationId: string
    actorId: string
    occurredAt: string
    reason: string
    artifactIds: TransitionArtifactIds
  },
): LifecycleResult {
  validateCommonCommand(command)
  requireText(command.reason, 'reason')
  if (
    hasOperation(experiment, command.operationId) ||
    experiment.lifecycle === 'paused' ||
    experiment.lifecycle === 'completed'
  ) {
    return unchanged(experiment)
  }
  if (!isActive(experiment.lifecycle)) {
    throw new ExperimentLifecycleError(
      'INVALID_TRANSITION',
      'Only an active experiment may be emergency paused',
    )
  }
  return simpleTransition(experiment, {
    ...command,
    to: 'paused',
    action: 'experiment.emergency_paused',
    resumeState: experiment.lifecycle,
    metadata: { emergency: true },
  })
}

export function resumeExperiment(
  experiment: Experiment,
  command: {
    operationId: string
    actorId: string
    occurredAt: string
    artifactIds: TransitionArtifactIds
  },
): LifecycleResult {
  validateCommonCommand(command)
  if (hasOperation(experiment, command.operationId))
    return unchanged(experiment)
  if (
    experiment.lifecycle !== 'paused' ||
    experiment.resumeState === undefined
  ) {
    throw new ExperimentLifecycleError(
      'INVALID_TRANSITION',
      'Only a paused experiment may resume',
    )
  }
  return simpleTransition(experiment, {
    ...command,
    to: experiment.resumeState,
    action: 'experiment.resumed',
    metadata: { previousPauseReason: experiment.pauseReason ?? 'unspecified' },
  })
}

export function completeExperiment(
  experiment: Experiment,
  command: {
    operationId: string
    actorId: string
    occurredAt: string
    artifactIds: TransitionArtifactIds
  },
): LifecycleResult {
  validateCommonCommand(command)
  if (
    hasOperation(experiment, command.operationId) ||
    experiment.lifecycle === 'completed'
  )
    return unchanged(experiment)
  if (!isActive(experiment.lifecycle) && experiment.lifecycle !== 'paused') {
    throw new ExperimentLifecycleError(
      'INVALID_TRANSITION',
      'Only a started experiment may complete',
    )
  }
  return simpleTransition(experiment, {
    ...command,
    to: 'completed',
    action: 'experiment.completed',
  })
}

export function resetExperimentInPlace(experiment: Experiment): never {
  void experiment
  throw new ExperimentLifecycleError(
    'IN_PLACE_RESET_PROHIBITED',
    'An experiment cannot be reset in place; clone its configuration into a new draft',
  )
}

export function cloneExperimentToDraft(
  source: Experiment,
  command: {
    newExperimentId: string
    newName: string
    operationId: string
    actorId: string
    occurredAt: string
    auditRecordId: string
  },
): {
  readonly experiment: Experiment
  readonly auditRecord: ExperimentAuditRecord
} {
  requireText(command.newExperimentId, 'newExperimentId')
  requireText(command.newName, 'newName')
  requireText(command.operationId, 'operationId')
  requireText(command.actorId, 'actorId')
  requireText(command.auditRecordId, 'auditRecordId')
  requireTimestamp(command.occurredAt, 'occurredAt')
  if (command.newExperimentId === source.id) {
    throw new ExperimentLifecycleError(
      'IN_PLACE_RESET_PROHIBITED',
      'Clone must use a new experiment ID',
    )
  }
  if (command.actorId !== source.ownerId) {
    throw new ExperimentLifecycleError(
      'OWNER_CONFIRMATION_REQUIRED',
      'Only the owner may clone an experiment',
    )
  }
  const configuration = copyConfiguration(
    source.configurationSnapshot?.configuration ?? source.draftConfiguration,
  )
  const clone: Experiment = {
    id: command.newExperimentId,
    ownerId: source.ownerId,
    name: command.newName,
    lifecycle: 'draft',
    draftConfiguration: configuration,
    sourceExperimentId: source.id,
    appliedOperationIds: [command.operationId],
  }
  return {
    experiment: clone,
    auditRecord: auditRecord({
      id: command.auditRecordId,
      experiment: clone,
      actorId: command.actorId,
      action: 'experiment.cloned',
      occurredAt: command.occurredAt,
      operationId: command.operationId,
      metadata: { sourceExperimentId: source.id },
    }),
  }
}

export function controlsForExperiment(
  experiment: Experiment,
): ExperimentControls {
  const active = isActive(experiment.lifecycle)
  return {
    agentCallsAllowed: active,
    simulatedOrdersAllowed:
      experiment.lifecycle === 'replay' ||
      experiment.lifecycle === 'live_paper',
    proposalOnly: experiment.lifecycle === 'shadow',
    dataIngestionAllowed: experiment.lifecycle !== 'completed',
  }
}

function isActive(
  state: ExperimentLifecycleState,
): state is ActiveExperimentState {
  return state === 'replay' || state === 'shadow' || state === 'live_paper'
}
