import { z } from 'zod'

const MAX_BIGINT_TEXT = '9223372036854775807'
const CANONICAL_BIGINT_TEXT = /^(0|[1-9][0-9]*)$/
const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REVIEW_YEAR_START = Date.parse('2026-01-01T00:00:00.000Z')
const REVIEW_YEAR_END = Date.parse('2027-01-01T00:00:00.000Z')

export const hostedManualCycleReasons = [
  'market_closed',
  'outside_regular_session',
  'market_data_runtime_disabled',
] as const
export type HostedManualCycleReason = (typeof hostedManualCycleReasons)[number]

export const hostedManualCycleUnavailableReasons = [
  'scheduler_provider_not_manual',
  'experiment_not_active',
  'execution_mode_not_supported',
  'locked_version_unavailable',
  'controls_unavailable',
  'remote_scheduler_must_remain_disabled',
  'agent_must_remain_disabled',
  'experiment_emergency_paused',
  'paper_account_not_active',
  'locked_runtime_contract_unavailable',
] as const
export type HostedManualCycleUnavailableReason =
  (typeof hostedManualCycleUnavailableReasons)[number]

function isCanonicalBigintText(value: string): boolean {
  return (
    CANONICAL_BIGINT_TEXT.test(value) &&
    (value.length < MAX_BIGINT_TEXT.length ||
      (value.length === MAX_BIGINT_TEXT.length && value <= MAX_BIGINT_TEXT))
  )
}

function exactRevision(label: string) {
  return z
    .string()
    .regex(CANONICAL_BIGINT_TEXT, `${label} is invalid`)
    .refine(isCanonicalBigintText, {
      message: `${label} is outside the supported range`,
    })
}

const hostedManualCycleSchema = z.object({
  operationId: z.string().uuid('Cycle operation is invalid'),
  experimentId: z.string().uuid('Experiment is invalid'),
  expectedControlStateVersion: exactRevision('Control revision'),
  decisionAt: z
    .string()
    .datetime({ offset: true, message: 'Decision time is invalid' })
    .refine(
      (value) => {
        const instant = Date.parse(value)
        return instant >= REVIEW_YEAR_START && instant < REVIEW_YEAR_END
      },
      { message: 'Decision time is outside the reviewed 2026 calendar' },
    ),
  confirmation: z
    .string()
    .max(32, 'Confirmation is too long')
    .refine((value) => value === 'RUN PAPER CYCLE', {
      message: 'Enter RUN PAPER CYCLE exactly',
    }),
})

export type HostedManualCycleInput = z.infer<typeof hostedManualCycleSchema>
export type HostedManualCycleField = keyof HostedManualCycleInput

export type HostedManualCycleActionState = {
  status: 'idle' | 'error' | 'unknown'
  message?: string
  fieldErrors?: Partial<Record<HostedManualCycleField, string>>
}

export const initialHostedManualCycleActionState: HostedManualCycleActionState =
  { status: 'idle' }

export function parseHostedManualCycleForm(
  formData: FormData,
):
  | { success: true; data: HostedManualCycleInput }
  | { success: false; state: HostedManualCycleActionState } {
  const parsed = hostedManualCycleSchema.safeParse({
    operationId: formData.get('operationId'),
    experimentId: formData.get('experimentId'),
    expectedControlStateVersion: formData.get('expectedControlStateVersion'),
    decisionAt: formData.get('decisionAt'),
    confirmation: formData.get('confirmation'),
  })

  if (parsed.success) return parsed

  const fields = parsed.error.flatten().fieldErrors
  return {
    success: false,
    state: {
      status: 'error',
      message: 'Review the paper cycle confirmation.',
      fieldErrors: {
        operationId: fields.operationId?.[0],
        experimentId: fields.experimentId?.[0],
        expectedControlStateVersion: fields.expectedControlStateVersion?.[0],
        decisionAt: fields.decisionAt?.[0],
        confirmation: fields.confirmation?.[0],
      },
    },
  }
}

export interface HostedManualCycleStateRow {
  experiment_id: string | null
  decision_at: string | null
  control_state_version: string | null
  scheduler_provider: string | null
  ready: boolean | null
  reason: string | null
  last_scheduler_run_id: string | null
  last_simulator_run_id: string | null
  last_slot_key: string | null
  last_status: string | null
  last_reason: string | null
  last_decision_at: string | null
}

export type HostedManualCycleLastRun = {
  schedulerRunId: string
  simulatorRunId: string
  slotKey: string
  status: 'skipped'
  reason: HostedManualCycleReason
  decisionAt: string
}

export type HostedManualCycleState =
  | {
      status: 'available'
      experimentId: string
      decisionAt: string
      controlStateVersion: string
      schedulerProvider: 'manual' | null
      ready: boolean
      reason: HostedManualCycleUnavailableReason | null
      lastRun: HostedManualCycleLastRun | null
    }
  | { status: 'unavailable' }

function isInstant(value: string | null): value is string {
  return value !== null && Number.isFinite(Date.parse(value))
}

function isCycleReason(value: string | null): value is HostedManualCycleReason {
  return (
    value !== null &&
    hostedManualCycleReasons.includes(value as HostedManualCycleReason)
  )
}

function isUnavailableReason(
  value: string | null,
): value is HostedManualCycleUnavailableReason {
  return (
    value !== null &&
    hostedManualCycleUnavailableReasons.includes(
      value as HostedManualCycleUnavailableReason,
    )
  )
}

export function mapHostedManualCycleState(
  row: HostedManualCycleStateRow,
  expectedExperimentId: string,
): HostedManualCycleState {
  if (
    !row.experiment_id ||
    row.experiment_id.toLowerCase() !== expectedExperimentId.toLowerCase() ||
    !isInstant(row.decision_at) ||
    !row.control_state_version ||
    !isCanonicalBigintText(row.control_state_version) ||
    ![null, 'manual'].includes(row.scheduler_provider) ||
    typeof row.ready !== 'boolean' ||
    (row.ready &&
      (row.scheduler_provider !== 'manual' || row.reason !== null)) ||
    (!row.ready && !isUnavailableReason(row.reason))
  ) {
    return { status: 'unavailable' }
  }

  const lastValues = [
    row.last_scheduler_run_id,
    row.last_simulator_run_id,
    row.last_slot_key,
    row.last_status,
    row.last_reason,
    row.last_decision_at,
  ]
  const hasLastRun = lastValues.some((value) => value !== null)
  let lastRun: HostedManualCycleLastRun | null = null

  if (hasLastRun) {
    const expectedSlotPrefix = `hosted-paper-cycle:${expectedExperimentId.toLowerCase()}:`
    if (
      !row.last_scheduler_run_id ||
      !CANONICAL_UUID.test(row.last_scheduler_run_id) ||
      !row.last_simulator_run_id ||
      !CANONICAL_UUID.test(row.last_simulator_run_id) ||
      !row.last_slot_key ||
      !row.last_slot_key.toLowerCase().startsWith(expectedSlotPrefix) ||
      row.last_status !== 'skipped' ||
      !isCycleReason(row.last_reason) ||
      !isInstant(row.last_decision_at) ||
      Date.parse(row.last_decision_at) > Date.parse(row.decision_at)
    ) {
      return { status: 'unavailable' }
    }

    lastRun = {
      schedulerRunId: row.last_scheduler_run_id,
      simulatorRunId: row.last_simulator_run_id,
      slotKey: row.last_slot_key,
      status: 'skipped',
      reason: row.last_reason,
      decisionAt: row.last_decision_at,
    }
  }

  return {
    status: 'available',
    experimentId: row.experiment_id,
    decisionAt: row.decision_at,
    controlStateVersion: row.control_state_version,
    schedulerProvider: row.scheduler_provider as 'manual' | null,
    ready: row.ready,
    reason: row.reason as HostedManualCycleUnavailableReason | null,
    lastRun,
  }
}
