import 'server-only'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type LogContext = {
  correlationId?: string
  experimentId?: string
  schedulerRunId?: string
  agentRunId?: string
  provider?: string
  operation: string
  errorClass?: string
  metadata?: Record<string, string | number | boolean | null>
}

const forbiddenKeys = /(?:secret|token|password|authorization|api[_-]?key)/i

function sanitizedContext(context: LogContext): LogContext {
  const metadata = Object.fromEntries(
    Object.entries(context.metadata ?? {}).filter(
      ([key]) => !forbiddenKeys.test(key),
    ),
  )
  return { ...context, metadata }
}

export function log(
  level: LogLevel,
  message: string,
  context: LogContext,
): void {
  const record = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...sanitizedContext(context),
  }
  const output = JSON.stringify(record)
  if (level === 'error') console.error(output)
  else if (level === 'warn') console.warn(output)
  else console.log(output)
}
