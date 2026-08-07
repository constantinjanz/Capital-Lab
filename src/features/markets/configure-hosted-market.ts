import { z } from 'zod'

const canonicalUuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)

const hostedMarketConfigurationSchema = z.object({
  operationId: z.string().uuid('Market setup operation is invalid'),
})

const hostedMarketConfigurationRowSchema = z
  .object({
    operation_id: canonicalUuid,
    status: z.literal('configured'),
    universe_id: canonicalUuid,
    source_id: canonicalUuid,
    replayed: z.boolean(),
  })
  .strict()

export type HostedMarketConfigurationInput = z.infer<
  typeof hostedMarketConfigurationSchema
>

export type HostedMarketConfigurationActionState = {
  status: 'idle' | 'success' | 'error' | 'unknown'
  message?: string
  fieldErrors?: { operationId?: string }
}

export type HostedMarketConfigurationResult = {
  operationId: string
  universeId: string
  sourceId: string
  replayed: boolean
}

export const initialHostedMarketConfigurationActionState: HostedMarketConfigurationActionState =
  { status: 'idle' }

export function parseHostedMarketConfigurationForm(
  formData: FormData,
):
  | { success: true; data: HostedMarketConfigurationInput }
  | { success: false; state: HostedMarketConfigurationActionState } {
  const parsed = hostedMarketConfigurationSchema.safeParse({
    operationId: formData.get('operationId'),
  })

  if (parsed.success) return parsed

  return {
    success: false,
    state: {
      status: 'error',
      message: 'Reload Markets to start a valid configuration operation.',
      fieldErrors: {
        operationId:
          parsed.error.flatten().fieldErrors.operationId?.[0] ??
          'Market setup operation is invalid',
      },
    },
  }
}

export function mapHostedMarketConfigurationResult(
  data: unknown,
  expectedOperationId: string,
): HostedMarketConfigurationResult | null {
  const parsed = z
    .array(hostedMarketConfigurationRowSchema)
    .length(1)
    .safeParse(data)
  if (!parsed.success) return null

  const result = parsed.data[0]
  if (result.operation_id.toLowerCase() !== expectedOperationId.toLowerCase()) {
    return null
  }

  return {
    operationId: result.operation_id,
    universeId: result.universe_id,
    sourceId: result.source_id,
    replayed: result.replayed,
  }
}
