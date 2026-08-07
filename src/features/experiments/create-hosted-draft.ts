import { z } from 'zod'

const hostedDraftSchema = z.object({
  operationId: z.string().uuid('Draft operation is invalid'),
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

export type HostedDraftInput = z.infer<typeof hostedDraftSchema>
export type HostedDraftField = keyof HostedDraftInput

export type HostedDraftActionState = {
  status: 'idle' | 'error'
  message?: string
  fieldErrors?: Partial<Record<HostedDraftField, string>>
}

export const initialHostedDraftActionState: HostedDraftActionState = {
  status: 'idle',
}

export type HostedDraftParseResult =
  | { success: true; data: HostedDraftInput }
  | { success: false; state: HostedDraftActionState }

export function parseHostedDraftForm(
  formData: FormData,
): HostedDraftParseResult {
  const parsed = hostedDraftSchema.safeParse({
    operationId: formData.get('operationId'),
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
        name: flattened.name?.[0],
        objective: flattened.objective?.[0],
      },
    },
  }
}
