import { z } from 'zod'

export const HOSTED_OFFICIAL_CALENDAR_MANIFEST_ID =
  'capital_lab_us_equities_calendar_2026_v1'

const canonicalUuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)

const configurationInputSchema = z.object({
  operationId: z.string().uuid('Calendar setup operation is invalid'),
})

const configurationRowSchema = z
  .object({
    operation_id: canonicalUuid,
    status: z.literal('configured'),
    manifest_record_id: canonicalUuid,
    source_count: z.literal(2),
    session_count: z.literal(522),
    replayed: z.boolean(),
  })
  .strict()

const stateRowSchema = z
  .object({
    owner_id: canonicalUuid,
    decision_at: z.iso.datetime(),
    configured: z.boolean(),
    manifest_id: z.string().nullable(),
    manifest_record_id: canonicalUuid.nullable(),
    calendar_year: z.literal(2026),
    exchange_count: z.number().int().nonnegative(),
    session_count: z.number().int().nonnegative(),
    regular_session_count: z.number().int().nonnegative(),
    early_close_session_count: z.number().int().nonnegative(),
    closed_session_count: z.number().int().nonnegative(),
  })
  .strict()

export type HostedOfficialCalendarConfigurationInput = z.infer<
  typeof configurationInputSchema
>

export type HostedOfficialCalendarConfigurationActionState = {
  status: 'idle' | 'success' | 'error' | 'unknown'
  message?: string
  fieldErrors?: { operationId?: string }
}

export type HostedOfficialCalendarConfigurationResult = {
  operationId: string
  manifestRecordId: string
  sourceCount: 2
  sessionCount: 522
  replayed: boolean
}

export type HostedOfficialCalendarState =
  | {
      status: 'configured'
      decisionAt: string
      manifestId: typeof HOSTED_OFFICIAL_CALENDAR_MANIFEST_ID
      manifestRecordId: string
      calendarYear: 2026
      exchangeCount: 2
      sessionCount: 522
      regularSessionCount: 498
      earlyCloseSessionCount: 4
      closedSessionCount: 20
    }
  | {
      status: 'unconfigured'
      decisionAt: string
      calendarYear: 2026
    }
  | {
      status: 'unavailable'
      calendarYear: 2026
    }

export const initialHostedOfficialCalendarConfigurationActionState: HostedOfficialCalendarConfigurationActionState =
  { status: 'idle' }

export function parseHostedOfficialCalendarConfigurationForm(
  formData: FormData,
):
  | { success: true; data: HostedOfficialCalendarConfigurationInput }
  | {
      success: false
      state: HostedOfficialCalendarConfigurationActionState
    } {
  const parsed = configurationInputSchema.safeParse({
    operationId: formData.get('operationId'),
  })
  if (parsed.success) return parsed

  return {
    success: false,
    state: {
      status: 'error',
      message: 'Reload Markets to start a valid calendar setup operation.',
      fieldErrors: {
        operationId:
          parsed.error.flatten().fieldErrors.operationId?.[0] ??
          'Calendar setup operation is invalid',
      },
    },
  }
}

export function mapHostedOfficialCalendarConfigurationResult(
  data: unknown,
  expectedOperationId: string,
): HostedOfficialCalendarConfigurationResult | null {
  const parsed = z.array(configurationRowSchema).length(1).safeParse(data)
  if (!parsed.success) return null

  const result = parsed.data[0]
  if (result.operation_id.toLowerCase() !== expectedOperationId.toLowerCase()) {
    return null
  }

  return {
    operationId: result.operation_id,
    manifestRecordId: result.manifest_record_id,
    sourceCount: result.source_count,
    sessionCount: result.session_count,
    replayed: result.replayed,
  }
}

export function mapHostedOfficialCalendarState(
  data: unknown,
  expectedOwnerId: string,
): Exclude<HostedOfficialCalendarState, { status: 'unavailable' }> {
  const parsed = z.array(stateRowSchema).length(1).safeParse(data)
  if (!parsed.success)
    throw new Error('Hosted official calendar state is invalid')

  const state = parsed.data[0]
  if (state.owner_id.toLowerCase() !== expectedOwnerId.toLowerCase()) {
    throw new Error('Hosted official calendar owner does not match')
  }

  if (!state.configured) {
    if (
      state.manifest_id !== null ||
      state.manifest_record_id !== null ||
      state.exchange_count !== 0 ||
      state.session_count !== 0 ||
      state.regular_session_count !== 0 ||
      state.early_close_session_count !== 0 ||
      state.closed_session_count !== 0
    ) {
      throw new Error('Unconfigured official calendar state has evidence')
    }
    return {
      status: 'unconfigured',
      decisionAt: state.decision_at,
      calendarYear: 2026,
    }
  }

  if (
    state.manifest_id !== HOSTED_OFFICIAL_CALENDAR_MANIFEST_ID ||
    state.manifest_record_id === null ||
    state.exchange_count !== 2 ||
    state.session_count !== 522 ||
    state.regular_session_count !== 498 ||
    state.early_close_session_count !== 4 ||
    state.closed_session_count !== 20
  ) {
    throw new Error('Configured official calendar state is incomplete')
  }

  return {
    status: 'configured',
    decisionAt: state.decision_at,
    manifestId: HOSTED_OFFICIAL_CALENDAR_MANIFEST_ID,
    manifestRecordId: state.manifest_record_id,
    calendarYear: 2026,
    exchangeCount: 2,
    sessionCount: 522,
    regularSessionCount: 498,
    earlyCloseSessionCount: 4,
    closedSessionCount: 20,
  }
}
