import { requirePositive } from '../financial/decimal'
import type {
  ExperimentConfiguration,
  ExperimentVersionReferences,
  StartReadiness,
} from './types'

export type ConfigurationIssueCode =
  | 'INVALID_REVISION'
  | 'INVALID_BASE_CURRENCY'
  | 'INVALID_INITIAL_CAPITAL'
  | 'MISSING_OBJECTIVE'
  | 'INVALID_TIME_RANGE'
  | 'MISSING_VERSION_REFERENCE'

export interface ConfigurationIssue {
  readonly code: ConfigurationIssueCode
  readonly field: string
}

export type ReadinessIssueCode =
  | 'DATA_PROVIDER_UNAVAILABLE'
  | 'MARKET_CALENDAR_UNAVAILABLE'
  | 'INVALID_SIMULATOR_CONFIG'
  | 'INVALID_RISK_CONFIG'
  | 'INVALID_BUDGET_POLICY'
  | 'PAPER_EXECUTION_UNAVAILABLE'
  | 'BROKER_TRADING_INTEGRATION_PRESENT'

function validTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value))
}

function missingVersionFields(versions: ExperimentVersionReferences): string[] {
  return (
    Object.entries(versions) as [keyof ExperimentVersionReferences, string][]
  )
    .filter(([, value]) => value.trim().length === 0)
    .map(([field]) => `versions.${field}`)
}

export function validateExperimentConfiguration(
  configuration: ExperimentConfiguration,
): readonly ConfigurationIssue[] {
  const issues: ConfigurationIssue[] = []
  if (!Number.isInteger(configuration.revision) || configuration.revision < 1) {
    issues.push({ code: 'INVALID_REVISION', field: 'revision' })
  }
  if (!/^[A-Z]{3}$/.test(configuration.baseCurrency)) {
    issues.push({ code: 'INVALID_BASE_CURRENCY', field: 'baseCurrency' })
  }
  try {
    requirePositive(configuration.initialCapital, 'initialCapital')
  } catch {
    issues.push({ code: 'INVALID_INITIAL_CAPITAL', field: 'initialCapital' })
  }
  if (configuration.objective.trim().length === 0) {
    issues.push({ code: 'MISSING_OBJECTIVE', field: 'objective' })
  }
  if (
    !validTimestamp(configuration.startAt) ||
    !validTimestamp(configuration.endAt) ||
    Date.parse(configuration.endAt) <= Date.parse(configuration.startAt)
  ) {
    issues.push({ code: 'INVALID_TIME_RANGE', field: 'startAt/endAt' })
  }
  for (const field of missingVersionFields(configuration.versions)) {
    issues.push({ code: 'MISSING_VERSION_REFERENCE', field })
  }
  return issues
}

export function validateStartReadiness(
  readiness: StartReadiness,
): readonly ReadinessIssueCode[] {
  const issues: ReadinessIssueCode[] = []
  if (!readiness.dataProviderReady) issues.push('DATA_PROVIDER_UNAVAILABLE')
  if (!readiness.marketCalendarReady) issues.push('MARKET_CALENDAR_UNAVAILABLE')
  if (!readiness.simulatorConfigValid) issues.push('INVALID_SIMULATOR_CONFIG')
  if (!readiness.riskConfigValid) issues.push('INVALID_RISK_CONFIG')
  if (!readiness.budgetPolicyValid) issues.push('INVALID_BUDGET_POLICY')
  if (!readiness.paperExecutionServiceReady)
    issues.push('PAPER_EXECUTION_UNAVAILABLE')
  if (readiness.brokerTradingIntegrationPresent)
    issues.push('BROKER_TRADING_INTEGRATION_PRESENT')
  return issues
}
