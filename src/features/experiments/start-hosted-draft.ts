import { z } from 'zod'

const MAX_BIGINT_TEXT = '9223372036854775807'
const canonicalRevision = /^(0|[1-9][0-9]*)$/

export const hostedExperimentStartModes = ['replay', 'shadow'] as const
export type HostedExperimentStartMode =
  (typeof hostedExperimentStartModes)[number]

const exactRevision = (label: string) =>
  z
    .string()
    .regex(canonicalRevision, `${label} is invalid`)
    .refine(
      (value) =>
        value.length < MAX_BIGINT_TEXT.length ||
        (value.length === MAX_BIGINT_TEXT.length && value <= MAX_BIGINT_TEXT),
      { message: `${label} is outside the supported range` },
    )

const hostedExperimentStartSchema = z
  .object({
    operationId: z.string().uuid('Start operation is invalid'),
    experimentId: z.string().uuid('Experiment is invalid'),
    expectedDraftRevision: exactRevision('Draft revision'),
    expectedControlStateVersion: exactRevision('Control revision'),
    mode: z.enum(hostedExperimentStartModes),
    confirmation: z.string().max(32, 'Confirmation is too long'),
  })
  .superRefine((value, context) => {
    const expected = value.mode === 'replay' ? 'START REPLAY' : 'START SHADOW'
    if (value.confirmation !== expected) {
      context.addIssue({
        code: 'custom',
        path: ['confirmation'],
        message: `Enter ${expected} exactly`,
      })
    }
  })

export type HostedExperimentStartInput = z.infer<
  typeof hostedExperimentStartSchema
>
export type HostedExperimentStartField = keyof HostedExperimentStartInput

export type HostedExperimentStartActionState = {
  status: 'idle' | 'error' | 'unknown'
  message?: string
  fieldErrors?: Partial<Record<HostedExperimentStartField, string>>
}

export const initialHostedExperimentStartActionState: HostedExperimentStartActionState =
  { status: 'idle' }

export type HostedExperimentStartParseResult =
  | { success: true; data: HostedExperimentStartInput }
  | { success: false; state: HostedExperimentStartActionState }

export function parseHostedExperimentStartForm(
  formData: FormData,
): HostedExperimentStartParseResult {
  const parsed = hostedExperimentStartSchema.safeParse({
    operationId: formData.get('operationId'),
    experimentId: formData.get('experimentId'),
    expectedDraftRevision: formData.get('expectedDraftRevision'),
    expectedControlStateVersion: formData.get('expectedControlStateVersion'),
    mode: formData.get('mode'),
    confirmation: formData.get('confirmation'),
  })

  if (parsed.success) return parsed

  const flattened = parsed.error.flatten().fieldErrors
  return {
    success: false,
    state: {
      status: 'error',
      message: 'Review the experiment start fields.',
      fieldErrors: {
        operationId: flattened.operationId?.[0],
        experimentId: flattened.experimentId?.[0],
        expectedDraftRevision: flattened.expectedDraftRevision?.[0],
        expectedControlStateVersion: flattened.expectedControlStateVersion?.[0],
        mode: flattened.mode?.[0],
        confirmation: flattened.confirmation?.[0],
      },
    },
  }
}

export interface HostedExperimentStartReadinessRow {
  experiment_id: string | null
  decision_at: string | null
  draft_revision: string | null
  control_state_version: string | null
  draft_ready: boolean | null
  start_manifest_id: string | null
  market_manifest_id: string | null
  universe_id: string | null
  calendar_manifest_id: string | null
  calendar_manifest_record_id: string | null
  ready: boolean | null
}

export type HostedExperimentStartReadiness =
  | {
      status: 'available'
      experimentId: string
      decisionAt: string
      draftRevision: string
      controlStateVersion: string
      draftReady: boolean
      startManifestId: string
      marketManifestId: string | null
      universeId: string | null
      calendarManifestId: string | null
      calendarManifestRecordId: string | null
      ready: boolean
    }
  | { status: 'unavailable' }

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isCanonicalBigintText(value: string): boolean {
  return (
    canonicalRevision.test(value) &&
    (value.length < MAX_BIGINT_TEXT.length ||
      (value.length === MAX_BIGINT_TEXT.length && value <= MAX_BIGINT_TEXT))
  )
}

export function mapHostedExperimentStartReadiness(
  row: HostedExperimentStartReadinessRow,
  expectedExperimentId: string,
): HostedExperimentStartReadiness {
  if (
    !row.experiment_id ||
    row.experiment_id.toLowerCase() !== expectedExperimentId.toLowerCase() ||
    !row.decision_at ||
    !Number.isFinite(Date.parse(row.decision_at)) ||
    !row.draft_revision ||
    !isCanonicalBigintText(row.draft_revision) ||
    !row.control_state_version ||
    !isCanonicalBigintText(row.control_state_version) ||
    typeof row.draft_ready !== 'boolean' ||
    row.start_manifest_id !== 'capital_lab_disabled_runtime_start_v1' ||
    ![null, 'capital_lab_us_core_alpaca_iex_v1'].includes(
      row.market_manifest_id,
    ) ||
    ![null, 'capital_lab_us_equities_calendar_2026_v1'].includes(
      row.calendar_manifest_id,
    ) ||
    typeof row.ready !== 'boolean'
  ) {
    return { status: 'unavailable' }
  }

  const optionalIds = [row.universe_id, row.calendar_manifest_record_id].filter(
    (value): value is string => value !== null,
  )
  if (optionalIds.some((value) => !CANONICAL_UUID.test(value))) {
    return { status: 'unavailable' }
  }

  if (
    row.ready &&
    (!row.draft_ready ||
      row.market_manifest_id !== 'capital_lab_us_core_alpaca_iex_v1' ||
      !row.universe_id ||
      row.calendar_manifest_id !== 'capital_lab_us_equities_calendar_2026_v1' ||
      !row.calendar_manifest_record_id)
  ) {
    return { status: 'unavailable' }
  }

  return {
    status: 'available',
    experimentId: row.experiment_id,
    decisionAt: row.decision_at,
    draftRevision: row.draft_revision,
    controlStateVersion: row.control_state_version,
    draftReady: row.draft_ready,
    startManifestId: row.start_manifest_id,
    marketManifestId: row.market_manifest_id,
    universeId: row.universe_id,
    calendarManifestId: row.calendar_manifest_id,
    calendarManifestRecordId: row.calendar_manifest_record_id,
    ready: row.ready,
  }
}
