export type MarketSessionState = {
  eligible: boolean
  sessionDate: string
  reason?: 'weekend' | 'outside_regular_hours'
}

function zonedParts(at: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''
  return {
    weekday: get('weekday'),
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minuteOfDay: Number(get('hour')) * 60 + Number(get('minute')),
  }
}

/**
 * Deterministic mock calendar. Live mode must load versioned official sessions
 * from `market_sessions`; this helper deliberately handles weekdays only.
 */
export function mockUsRegularSession(at: Date): MarketSessionState {
  const parts = zonedParts(at)
  if (parts.weekday === 'Sat' || parts.weekday === 'Sun') {
    return { eligible: false, sessionDate: parts.date, reason: 'weekend' }
  }
  const eligible = parts.minuteOfDay >= 570 && parts.minuteOfDay < 960
  return {
    eligible,
    sessionDate: parts.date,
    reason: eligible ? undefined : 'outside_regular_hours',
  }
}

export function fifteenMinuteSlotKey(
  jobType: string,
  experimentId: string,
  at: Date,
): string {
  const boundary = new Date(at)
  boundary.setUTCSeconds(0, 0)
  boundary.setUTCMinutes(Math.floor(boundary.getUTCMinutes() / 15) * 15)
  return `${jobType}:${experimentId}:${boundary.toISOString()}`
}
