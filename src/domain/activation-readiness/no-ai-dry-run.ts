export const NO_AI_DRY_RUN_EXPERIMENT_ID =
  '6f4d4ac2-bbcb-4f2a-9a5e-5b05ead8d001'
export const NO_AI_DRY_RUN_TYPE = 'no_ai_shadow_infrastructure_dry_run'

export const activationStates = [
  'prepared',
  'infra_installed',
  'vault_verified',
  'jobs_installed_disabled',
  'auth_noop_verified',
  'baseline_frozen',
  'armed',
  'running',
  'auto_stopped',
  'reconciled',
  'passed',
  'failed',
  'aborted',
] as const

export type ActivationState = (typeof activationStates)[number]
export type CalendarSessionType = 'regular' | 'early_close' | 'closed'

export type VersionedMarketSession = {
  sessionDate: string
  sessionType: CalendarSessionType
  opensAt: string | null
  closesAt: string | null
  availableAt: string
}

export type ExpectedDryRunEvent = {
  eventKey: string
  sessionDate: string
  slotNumber: number
  eventType: 'market_dispatcher' | 'reconciler'
  expectedAt: string
}

export type NoAiDryRunPlan = {
  experimentId: typeof NO_AI_DRY_RUN_EXPERIMENT_ID
  experimentType: typeof NO_AI_DRY_RUN_TYPE
  plannedStartAt: string
  sessionDates: readonly [string, string]
  plannedEndAt: string
  expectedSlots: readonly string[]
  expectedEvents: readonly ExpectedDryRunEvent[]
}

const allowedTransitions: Readonly<Record<ActivationState, ActivationState[]>> =
  {
    prepared: ['infra_installed', 'failed', 'aborted'],
    infra_installed: ['vault_verified', 'failed', 'aborted'],
    vault_verified: ['jobs_installed_disabled', 'failed', 'aborted'],
    jobs_installed_disabled: ['auth_noop_verified', 'failed', 'aborted'],
    auth_noop_verified: ['baseline_frozen', 'failed', 'aborted'],
    baseline_frozen: ['armed', 'failed', 'aborted'],
    armed: ['running', 'failed', 'aborted'],
    running: ['auto_stopped', 'failed', 'aborted'],
    auto_stopped: ['reconciled', 'failed', 'aborted'],
    reconciled: ['passed', 'failed', 'aborted'],
    passed: [],
    failed: [],
    aborted: [],
  }

function timestamp(value: string, label: string): number {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be ISO-8601`)
  return parsed
}

function dateParts(value: string): [number, number, number] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw new Error('sessionDate must be an ISO calendar date')
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function weekdayDatesBetween(start: string, end: string): string[] {
  const [startYear, startMonth, startDay] = dateParts(start)
  const [endYear, endMonth, endDay] = dateParts(end)
  const cursor = new Date(Date.UTC(startYear, startMonth - 1, startDay))
  const final = Date.UTC(endYear, endMonth - 1, endDay)
  const dates: string[] = []

  while (cursor.getTime() <= final) {
    const weekday = cursor.getUTCDay()
    if (weekday !== 0 && weekday !== 6) {
      dates.push(cursor.toISOString().slice(0, 10))
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

export function assertActivationTransition(
  from: ActivationState,
  to: ActivationState,
): void {
  if (!allowedTransitions[from].includes(to)) {
    throw new Error(`activation transition ${from} -> ${to} is forbidden`)
  }
}

export function planNoAiInfrastructureDryRun(input: {
  activatedAt: string
  decisionAt: string
  activationSessionDate: string
  sessions: readonly VersionedMarketSession[]
  graceMinutes?: number
}): NoAiDryRunPlan {
  const activatedAt = timestamp(input.activatedAt, 'activatedAt')
  const decisionAt = timestamp(input.decisionAt, 'decisionAt')
  if (activatedAt > decisionAt) {
    throw new Error('activation cannot be planned after the decision boundary')
  }
  const graceMinutes = input.graceMinutes ?? 10
  if (
    !Number.isInteger(graceMinutes) ||
    graceMinutes < 5 ||
    graceMinutes > 30
  ) {
    throw new Error('graceMinutes must be an integer between 5 and 30')
  }

  const sessions = [...input.sessions]
    .filter(
      (session) => timestamp(session.availableAt, 'availableAt') <= decisionAt,
    )
    .sort((left, right) => left.sessionDate.localeCompare(right.sessionDate))
  const eligible = sessions.filter((session) => {
    if (
      session.sessionType !== 'regular' ||
      session.opensAt === null ||
      session.closesAt === null
    ) {
      return false
    }
    const opensAt = timestamp(session.opensAt, 'opensAt')
    const closesAt = timestamp(session.closesAt, 'closesAt')
    return opensAt > activatedAt && closesAt > opensAt
  })
  if (eligible.length < 2) {
    throw new Error('two complete regular sessions are unavailable')
  }

  const selected = eligible.slice(0, 2) as [
    VersionedMarketSession,
    VersionedMarketSession,
  ]
  const knownDates = new Set(sessions.map((session) => session.sessionDate))
  for (const date of weekdayDatesBetween(
    input.activationSessionDate,
    selected[1].sessionDate,
  )) {
    if (!knownDates.has(date)) {
      throw new Error(`calendar coverage is incomplete for ${date}`)
    }
  }

  const expectedEvents: ExpectedDryRunEvent[] = []
  const expectedSlots: string[] = []
  for (const session of selected) {
    const opensAt = timestamp(session.opensAt!, 'opensAt')
    const closesAt = timestamp(session.closesAt!, 'closesAt')
    if ((closesAt - opensAt) / 60_000 !== 390) {
      throw new Error('selected session is not a complete regular session')
    }
    for (
      let slotNumber = 0;
      opensAt + slotNumber * 900_000 < closesAt;
      slotNumber += 1
    ) {
      const slotAt = new Date(opensAt + slotNumber * 900_000).toISOString()
      const slotKey = `${session.sessionDate}:${slotNumber}`
      expectedSlots.push(slotKey)
      expectedEvents.push({
        eventKey: `${slotKey}:market_dispatcher`,
        sessionDate: session.sessionDate,
        slotNumber,
        eventType: 'market_dispatcher',
        expectedAt: slotAt,
      })
      expectedEvents.push({
        eventKey: `${slotKey}:reconciler`,
        sessionDate: session.sessionDate,
        slotNumber,
        eventType: 'reconciler',
        expectedAt: new Date(Date.parse(slotAt) + 300_000).toISOString(),
      })
    }
  }

  const plannedEndAt = new Date(
    timestamp(selected[1].closesAt!, 'closesAt') + graceMinutes * 60_000,
  ).toISOString()
  return {
    experimentId: NO_AI_DRY_RUN_EXPERIMENT_ID,
    experimentType: NO_AI_DRY_RUN_TYPE,
    plannedStartAt: selected[0].opensAt!,
    sessionDates: [selected[0].sessionDate, selected[1].sessionDate],
    plannedEndAt,
    expectedSlots,
    expectedEvents,
  }
}

export type ActualSlotEvidence = {
  slotKey: string
  cronTriggerCount: number
  requestIds: readonly string[]
  httpStatus: number | null
  timedOut: boolean
  authenticatedCount: number
  claimedCycleCount: number
  terminalReason: string | null
  modelCalls: number
  budgetReservations: number
  orders: number
  fills: number
  ledgerEntries: number
}

export function evaluateNoAiDryRun(input: {
  plan: NoAiDryRunPlan
  actualSlots: readonly ActualSlotEvidence[]
}): { passed: boolean; failures: readonly string[] } {
  const actualBySlot = new Map(
    input.actualSlots.map((actual) => [actual.slotKey, actual]),
  )
  const failures: string[] = []

  for (const slotKey of input.plan.expectedSlots) {
    const actual = actualBySlot.get(slotKey)
    if (!actual) {
      failures.push(`missing_slot:${slotKey}`)
      continue
    }
    if (actual.cronTriggerCount !== 1) failures.push(`cron_count:${slotKey}`)
    if (actual.requestIds.length !== 1)
      failures.push(`request_count:${slotKey}`)
    if (
      actual.httpStatus === null ||
      actual.httpStatus < 200 ||
      actual.httpStatus >= 300 ||
      actual.timedOut
    ) {
      failures.push(`http_result:${slotKey}`)
    }
    if (actual.authenticatedCount !== 1) failures.push(`auth_count:${slotKey}`)
    if (actual.claimedCycleCount !== 1) failures.push(`claim_count:${slotKey}`)
    if (actual.terminalReason !== 'no_ai_shadow_dry_run') {
      failures.push(`terminal_state:${slotKey}`)
    }
    if (
      actual.modelCalls !== 0 ||
      actual.budgetReservations !== 0 ||
      actual.orders !== 0 ||
      actual.fills !== 0 ||
      actual.ledgerEntries !== 0
    ) {
      failures.push(`forbidden_delta:${slotKey}`)
    }
  }

  for (const slotKey of actualBySlot.keys()) {
    if (!input.plan.expectedSlots.includes(slotKey)) {
      failures.push(`unexpected_slot:${slotKey}`)
    }
  }
  return { passed: failures.length === 0, failures }
}

export function shouldAutoStopNoAiDryRun(input: {
  plannedEndAt: string
  observedAt: string
}): boolean {
  return (
    timestamp(input.observedAt, 'observedAt') >=
    timestamp(input.plannedEndAt, 'plannedEndAt')
  )
}
