import { z } from 'zod'

const MAX_BIGINT_TEXT = '9223372036854775807'
const canonicalRevision = /^(0|[1-9][0-9]*)$/

export const hostedLifecycleActions = [
  'promote_live_paper',
  'pause',
  'resume',
  'complete',
  'clone',
] as const

export type HostedLifecycleAction = (typeof hostedLifecycleActions)[number]

const nullableText = (maximum: number) =>
  z.preprocess(
    (value) => (value === null || value === '' ? null : value),
    z.string().max(maximum).nullable(),
  )

const nullableUuid = z.preprocess(
  (value) => (value === null || value === '' ? null : value),
  z.string().uuid('Locked version is invalid').nullable(),
)

const hostedLifecycleSchema = z
  .object({
    operationId: z.string().uuid('Lifecycle operation is invalid'),
    experimentId: z.string().uuid('Experiment is invalid'),
    expectedControlStateVersion: z
      .string()
      .regex(canonicalRevision, 'Control revision is invalid')
      .refine(
        (value) =>
          value.length < MAX_BIGINT_TEXT.length ||
          (value.length === MAX_BIGINT_TEXT.length && value <= MAX_BIGINT_TEXT),
        { message: 'Control revision is outside the supported range' },
      ),
    action: z.enum(hostedLifecycleActions),
    reason: nullableText(200),
    confirmation: nullableText(64),
    lockedVersionId: nullableUuid,
    cloneName: nullableText(100),
  })
  .superRefine((value, context) => {
    const reason = value.reason?.trim() ?? null
    const cloneName = value.cloneName?.trim() ?? null

    if (value.action === 'pause') {
      if (!reason || reason.length < 3) {
        context.addIssue({
          code: 'custom',
          path: ['reason'],
          message: 'Pause reason must contain at least 3 characters',
        })
      }
    } else if (reason) {
      context.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'Pause reason is not accepted for this action',
      })
    }

    if (value.action === 'promote_live_paper') {
      if (value.confirmation !== 'PROMOTE TO LIVE PAPER') {
        context.addIssue({
          code: 'custom',
          path: ['confirmation'],
          message: 'Enter PROMOTE TO LIVE PAPER exactly',
        })
      }
      if (!value.lockedVersionId) {
        context.addIssue({
          code: 'custom',
          path: ['lockedVersionId'],
          message: 'Locked version is required',
        })
      }
    } else if (value.confirmation || value.lockedVersionId) {
      context.addIssue({
        code: 'custom',
        path: value.confirmation ? ['confirmation'] : ['lockedVersionId'],
        message: 'Live-paper confirmation is not accepted for this action',
      })
    }

    if (value.action === 'clone') {
      if (!cloneName || cloneName.length < 3) {
        context.addIssue({
          code: 'custom',
          path: ['cloneName'],
          message: 'Clone name must contain at least 3 characters',
        })
      }
    } else if (cloneName) {
      context.addIssue({
        code: 'custom',
        path: ['cloneName'],
        message: 'Clone name is not accepted for this action',
      })
    }
  })
  .transform((value) => ({
    ...value,
    reason: value.reason?.trim() || null,
    confirmation: value.confirmation || null,
    cloneName: value.cloneName?.trim() || null,
  }))

export type HostedLifecycleInput = z.infer<typeof hostedLifecycleSchema>
export type HostedLifecycleField = keyof HostedLifecycleInput

export type HostedLifecycleActionState = {
  status: 'idle' | 'error' | 'unknown'
  message?: string
  fieldErrors?: Partial<Record<HostedLifecycleField, string>>
}

export const initialHostedLifecycleActionState: HostedLifecycleActionState = {
  status: 'idle',
}

export type HostedLifecycleParseResult =
  | { success: true; data: HostedLifecycleInput }
  | { success: false; state: HostedLifecycleActionState }

export function parseHostedLifecycleForm(
  formData: FormData,
): HostedLifecycleParseResult {
  const parsed = hostedLifecycleSchema.safeParse({
    operationId: formData.get('operationId'),
    experimentId: formData.get('experimentId'),
    expectedControlStateVersion: formData.get('expectedControlStateVersion'),
    action: formData.get('action'),
    reason: formData.get('reason'),
    confirmation: formData.get('confirmation'),
    lockedVersionId: formData.get('lockedVersionId'),
    cloneName: formData.get('cloneName'),
  })

  if (parsed.success) return parsed

  const flattened = parsed.error.flatten().fieldErrors
  return {
    success: false,
    state: {
      status: 'error',
      message: 'Review the lifecycle action fields.',
      fieldErrors: {
        operationId: flattened.operationId?.[0],
        experimentId: flattened.experimentId?.[0],
        expectedControlStateVersion: flattened.expectedControlStateVersion?.[0],
        action: flattened.action?.[0],
        reason: flattened.reason?.[0],
        confirmation: flattened.confirmation?.[0],
        lockedVersionId: flattened.lockedVersionId?.[0],
        cloneName: flattened.cloneName?.[0],
      },
    },
  }
}
