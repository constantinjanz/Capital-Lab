import type { DecimalValue } from '../financial/decimal'

export type ActiveExperimentState = 'replay' | 'shadow' | 'live_paper'
export type ExperimentLifecycleState =
  'draft' | ActiveExperimentState | 'paused' | 'completed'

export interface ExperimentVersionReferences {
  readonly marketUniverseVersionId: string
  readonly simulatorConfigVersionId: string
  readonly riskConfigVersionId: string
  readonly agentPromptVersionId: string
  readonly modelRoutingVersionId: string
  readonly knowledgeCorpusVersionId: string
  readonly dataSourceConfigVersionId: string
  readonly budgetPolicyVersionId: string
  readonly marketCalendarVersionId: string
}

export interface ExperimentConfiguration {
  readonly revision: number
  readonly baseCurrency: string
  readonly initialCapital: DecimalValue
  readonly objective: string
  readonly startAt: string
  readonly endAt: string
  readonly regularHoursOnly: boolean
  readonly longEnabled: boolean
  readonly shortEnabled: boolean
  readonly versions: ExperimentVersionReferences
}

export interface ExperimentConfigurationSnapshot {
  readonly id: string
  readonly experimentId: string
  readonly lockedAt: string
  readonly configuration: ExperimentConfiguration
}

export interface Experiment {
  readonly id: string
  readonly ownerId: string
  readonly name: string
  readonly lifecycle: ExperimentLifecycleState
  readonly draftConfiguration: ExperimentConfiguration
  readonly configurationSnapshot?: ExperimentConfigurationSnapshot
  readonly lockedAt?: string
  readonly resumeState?: ActiveExperimentState
  readonly pauseReason?: string
  readonly completedAt?: string
  readonly sourceExperimentId?: string
  readonly appliedOperationIds: readonly string[]
}

export interface ExperimentStatusEvent {
  readonly id: string
  readonly experimentId: string
  readonly from: ExperimentLifecycleState
  readonly to: ExperimentLifecycleState
  readonly occurredAt: string
  readonly reason?: string
  readonly operationId: string
  readonly idempotencyKey: string
}

export interface ExperimentAuditRecord {
  readonly id: string
  readonly experimentId: string
  readonly actorId: string
  readonly action:
    | 'experiment.started'
    | 'experiment.promoted_live_paper'
    | 'experiment.paused'
    | 'experiment.emergency_paused'
    | 'experiment.resumed'
    | 'experiment.completed'
    | 'experiment.cloned'
  readonly occurredAt: string
  readonly operationId: string
  readonly idempotencyKey: string
  readonly metadata: Readonly<Record<string, string | boolean>>
}

export interface StartingCashArtifact {
  readonly id: string
  readonly experimentId: string
  readonly currency: string
  readonly amount: DecimalValue
  readonly component: 'starting_capital'
  readonly occurredAt: string
  readonly idempotencyKey: string
}

export interface InitialPortfolioArtifact {
  readonly id: string
  readonly experimentId: string
  readonly currency: string
  readonly cash: DecimalValue
  readonly netLiquidationValue: DecimalValue
  readonly realizedPnl: '0'
  readonly unrealizedPnl: '0'
  readonly grossExposure: '0'
  readonly netExposure: '0'
  readonly recordedAt: string
  readonly idempotencyKey: string
}

export interface LifecycleArtifacts {
  readonly statusEvents: readonly ExperimentStatusEvent[]
  readonly auditRecords: readonly ExperimentAuditRecord[]
  readonly startingCash?: StartingCashArtifact
  readonly initialPortfolio?: InitialPortfolioArtifact
}

export interface LifecycleResult {
  readonly changed: boolean
  readonly experiment: Experiment
  readonly artifacts: LifecycleArtifacts
}

export interface StartReadiness {
  readonly dataProviderReady: boolean
  readonly marketCalendarReady: boolean
  readonly simulatorConfigValid: boolean
  readonly riskConfigValid: boolean
  readonly budgetPolicyValid: boolean
  readonly paperExecutionServiceReady: boolean
  readonly brokerTradingIntegrationPresent: boolean
}

export interface TransitionArtifactIds {
  readonly statusEventId: string
  readonly auditRecordId: string
}

export interface StartArtifactIds extends TransitionArtifactIds {
  readonly configurationSnapshotId: string
  readonly startingCashId: string
  readonly initialPortfolioId: string
}

export interface ExperimentControls {
  readonly agentCallsAllowed: boolean
  readonly simulatedOrdersAllowed: boolean
  readonly proposalOnly: boolean
  readonly dataIngestionAllowed: boolean
}
