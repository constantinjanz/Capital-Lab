import { z } from 'zod'

const MAX_BIGINT_TEXT = '9223372036854775807'
const canonicalRevision = /^(0|[1-9][0-9]*)$/

const hostedDraftUpdateSchema = z.object({
  operationId: z.string().uuid('Draft update operation is invalid'),
  experimentId: z.string().uuid('Experiment is invalid'),
  expectedRevision: z
    .string()
    .regex(canonicalRevision, 'Draft revision is invalid')
    .refine(
      (value) =>
        value.length < MAX_BIGINT_TEXT.length ||
        (value.length === MAX_BIGINT_TEXT.length && value <= MAX_BIGINT_TEXT),
      {
        message: 'Draft revision is outside the supported range',
      },
    ),
  name: z
    .string()
    .trim()
    .min(3, 'Name must contain at least 3 characters')
    .max(100, 'Name must contain at most 100 characters'),
  objective: z
    .string()
    .trim()
    .min(10, 'Objective must contain at least 10 characters')
    .max(1000, 'Objective must contain at most 1000 characters'),
})

export type HostedDraftUpdateInput = z.infer<typeof hostedDraftUpdateSchema>
export type HostedDraftUpdateField = keyof HostedDraftUpdateInput

export type HostedDraftUpdateActionState = {
  status: 'idle' | 'error' | 'unknown'
  message?: string
  fieldErrors?: Partial<Record<HostedDraftUpdateField, string>>
}

export const initialHostedDraftUpdateActionState: HostedDraftUpdateActionState =
  {
    status: 'idle',
  }

export type HostedDraftUpdateParseResult =
  | { success: true; data: HostedDraftUpdateInput }
  | { success: false; state: HostedDraftUpdateActionState }

export function parseHostedDraftUpdateForm(
  formData: FormData,
): HostedDraftUpdateParseResult {
  const parsed = hostedDraftUpdateSchema.safeParse({
    operationId: formData.get('operationId'),
    experimentId: formData.get('experimentId'),
    expectedRevision: formData.get('expectedRevision'),
    name: formData.get('name'),
    objective: formData.get('objective'),
  })

  if (parsed.success) return parsed

  const flattened = parsed.error.flatten().fieldErrors
  return {
    success: false,
    state: {
      status: 'error',
      message: 'Review the highlighted draft fields.',
      fieldErrors: {
        operationId: flattened.operationId?.[0],
        experimentId: flattened.experimentId?.[0],
        expectedRevision: flattened.expectedRevision?.[0],
        name: flattened.name?.[0],
        objective: flattened.objective?.[0],
      },
    },
  }
}
