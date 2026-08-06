const compactNumber = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

export function formatMinorUnits(
  minorUnits: number,
  currency: 'EUR' | 'USD' = 'EUR',
) {
  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(minorUnits / 100)
}

export function formatCompactMinorUnits(minorUnits: number) {
  return `€${compactNumber.format(minorUnits / 100)}`
}

export function formatUtc(isoTimestamp: string) {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(new Date(isoTimestamp))
}

export function formatStatus(value: string) {
  return value
    .replaceAll(/[-_]/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}
