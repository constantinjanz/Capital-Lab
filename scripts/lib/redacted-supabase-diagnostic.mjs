const FAILURE_CATEGORIES = new Set([
  'migration_failed',
  'container_unhealthy',
  'registry_pull_failed',
  'port_conflict',
  'docker_unavailable',
  'service_start_failed',
  'unknown_redacted_failure',
])

const SERVICES = new Set([
  'analytics',
  'auth',
  'db',
  'edge_runtime',
  'functions',
  'imgproxy',
  'kong',
  'mailpit',
  'pooler',
  'realtime',
  'rest',
  'storage',
  'studio',
  'vector',
])

const DIAGNOSTIC_KEYS = [
  'container_or_service',
  'exit_code',
  'failure_category',
  'migration_basename',
  'signal',
  'sqlstate',
  'timeout',
]

function recognizedService(text) {
  const patterns = [
    /\bsupabase_(analytics|auth|db|edge_runtime|functions|imgproxy|kong|mailpit|pooler|realtime|rest|storage|studio|vector)(?:_|\b)/iu,
    /\b(?:container|service)\s+["']?(analytics|auth|db|edge_runtime|functions|imgproxy|kong|mailpit|pooler|realtime|rest|storage|studio|vector)\b/iu,
  ]
  for (const pattern of patterns) {
    const value = pattern.exec(text)?.[1]?.toLowerCase()
    if (value && SERVICES.has(value)) return value
  }
  return null
}

function failureCategory(text, outcome) {
  if (
    /\b(?:applying|apply|running)\s+migration\b|\bmigration(?:s)?\s+(?:failed|error)\b|\bsqlstate\s+[0-9a-z]{5}\b/iu.test(
      text,
    )
  ) {
    return 'migration_failed'
  }
  if (
    /\b(?:port|bind)\b[^\r\n]*(?:already (?:allocated|in use)|address already in use|failed)|\blisten tcp\b[^\r\n]*\bbind\b/iu.test(
      text,
    )
  ) {
    return 'port_conflict'
  }
  if (
    /\b(?:failed to pull|pull access denied|manifest unknown|manifest for .* not found|registry[^\r\n]*(?:denied|unavailable)|unauthorized[^\r\n]*(?:repository|registry))\b/iu.test(
      text,
    )
  ) {
    return 'registry_pull_failed'
  }
  if (
    /\b(?:unhealthy|health ?check failed|failed health ?check)\b/iu.test(text)
  ) {
    return 'container_unhealthy'
  }
  if (
    outcome.spawnError ||
    /\b(?:cannot connect to (?:the )?docker daemon|docker daemon is not running|docker desktop is not running|docker(?:\.exe)?[^\r\n]*(?:not found|is unavailable))\b/iu.test(
      text,
    )
  ) {
    return 'docker_unavailable'
  }
  if (
    outcome.timedOut ||
    outcome.signal ||
    /\b(?:failed to start|start(?:ing)?[^\r\n]*(?:failed|error)|service[^\r\n]*(?:failed|exited)|container[^\r\n]*(?:failed|exited))\b/iu.test(
      text,
    )
  ) {
    return 'service_start_failed'
  }
  return 'unknown_redacted_failure'
}

function safeSignal(value) {
  return typeof value === 'string' && /^[A-Z][A-Z0-9]{0,15}$/u.test(value)
    ? value
    : null
}

export function buildRedactedSupabaseDiagnostic(rawOutput, outcome) {
  const text = String(rawOutput).replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, '')
  const exitCode = Number.isInteger(outcome?.code) ? outcome.code : null
  const success =
    exitCode === 0 &&
    outcome?.timedOut !== true &&
    !outcome?.signal &&
    outcome?.spawnError !== true
  const migration = /(?:^|[\\/\s"'])(\d{14}_[a-z0-9_]+\.sql)\b/iu.exec(
    text,
  )?.[1]
  const sqlstate = /\bSQLSTATE[\s:=]+([0-9A-Z]{5})\b/iu.exec(text)?.[1]
  return {
    failure_category: success ? null : failureCategory(text, outcome ?? {}),
    container_or_service: success ? null : recognizedService(text),
    migration_basename: success ? null : (migration?.toLowerCase() ?? null),
    sqlstate: success ? null : (sqlstate?.toUpperCase() ?? null),
    timeout: outcome?.timedOut === true,
    signal: safeSignal(outcome?.signal),
    exit_code: exitCode,
  }
}

export function validateRedactedSupabaseDiagnostic(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join('\n') !== DIAGNOSTIC_KEYS.join('\n') ||
    !(
      value.failure_category === null ||
      FAILURE_CATEGORIES.has(value.failure_category)
    ) ||
    !(
      value.container_or_service === null ||
      SERVICES.has(value.container_or_service)
    ) ||
    !(
      value.migration_basename === null ||
      /^\d{14}_[a-z0-9_]+\.sql$/u.test(value.migration_basename)
    ) ||
    !(value.sqlstate === null || /^[0-9A-Z]{5}$/u.test(value.sqlstate)) ||
    typeof value.timeout !== 'boolean' ||
    !(value.signal === null || /^[A-Z][A-Z0-9]{0,15}$/u.test(value.signal)) ||
    !(value.exit_code === null || Number.isInteger(value.exit_code))
  ) {
    throw new Error('Redacted Supabase diagnostic is outside the allowlist')
  }
  return value
}

export function diagnosticFromStructuredOutput(output) {
  const lines = String(output)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .reverse()
  for (const line of lines) {
    try {
      return validateRedactedSupabaseDiagnostic(JSON.parse(line))
    } catch {
      // Only an exact allowlisted object is eligible for CI evidence.
    }
  }
  return null
}

export function redactedDiagnosticForCi(gate, structuredOutput, outcome) {
  const diagnostic = diagnosticFromStructuredOutput(structuredOutput)
  if (diagnostic) return diagnostic
  if (gate !== 'supabase-start') return null
  return buildRedactedSupabaseDiagnostic('', {
    code: outcome?.exitCode,
    signal: outcome?.signal,
    timedOut: outcome?.timedOut,
    spawnError: false,
  })
}
