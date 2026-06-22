import { format, formatDistanceToNow, differenceInDays, parseISO, isValid } from 'date-fns'

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '—'
  try {
    const d = typeof date === 'string' ? parseISO(date) : date
    if (!isValid(d)) return '—'
    return format(d, 'dd MMM yyyy')
  } catch {
    return '—'
  }
}

export function formatMonthYear(date: string | null | undefined): string {
  if (!date) return '—'
  try {
    const d = parseISO(date.length === 7 ? `${date}-01` : date)
    if (!isValid(d)) return date
    return format(d, 'MMM yyyy')
  } catch {
    return date
  }
}

export function daysUntil(date: string | null | undefined): number {
  if (!date) return 999
  try {
    return differenceInDays(parseISO(date), new Date())
  } catch {
    return 999
  }
}

export function fromNow(date: string | null | undefined): string {
  if (!date) return '—'
  try {
    return formatDistanceToNow(parseISO(date), { addSuffix: true })
  } catch {
    return '—'
  }
}

export function today(): string {
  return format(new Date(), 'yyyy-MM-dd')
}
