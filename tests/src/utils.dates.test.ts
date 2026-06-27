import { describe, it, expect } from 'vitest'
import { formatDate, formatMonthYear, daysUntil, today } from '../../src/utils/dates.ts'

describe('formatDate', () => {
  it('formats an ISO date string', () => {
    expect(formatDate('2024-06-15')).toBe('15 Jun 2024')
  })

  it('formats a Date object', () => {
    expect(formatDate(new Date('2024-01-01'))).toBe('01 Jan 2024')
  })

  it('returns — for null', () => {
    expect(formatDate(null)).toBe('—')
  })

  it('returns — for undefined', () => {
    expect(formatDate(undefined)).toBe('—')
  })

  it('returns — for empty string', () => {
    expect(formatDate('')).toBe('—')
  })

  it('returns — for invalid date string', () => {
    expect(formatDate('not-a-date')).toBe('—')
  })
})

describe('formatMonthYear', () => {
  it('formats a full ISO date', () => {
    expect(formatMonthYear('2024-06-15')).toBe('Jun 2024')
  })

  it('formats a YYYY-MM string (7 chars)', () => {
    expect(formatMonthYear('2024-06')).toBe('Jun 2024')
  })

  it('returns — for null', () => {
    expect(formatMonthYear(null)).toBe('—')
  })

  it('returns — for undefined', () => {
    expect(formatMonthYear(undefined)).toBe('—')
  })

  it('returns the input unchanged for an unparseable string', () => {
    expect(formatMonthYear('garbage')).toBe('garbage')
  })
})

describe('daysUntil', () => {
  it('returns a positive number for a future date', () => {
    const future = new Date()
    future.setDate(future.getDate() + 30)
    const iso = future.toISOString().slice(0, 10)
    const result = daysUntil(iso)
    // Allow ±2 due to time-of-day and timezone differences
    expect(result).toBeGreaterThanOrEqual(28)
    expect(result).toBeLessThanOrEqual(32)
  })

  it('returns a negative number for a past date', () => {
    const past = new Date()
    past.setDate(past.getDate() - 10)
    const iso = past.toISOString().slice(0, 10)
    expect(daysUntil(iso)).toBeLessThan(0)
  })

  it('returns 999 for null', () => {
    expect(daysUntil(null)).toBe(999)
  })

  it('returns 999 for undefined', () => {
    expect(daysUntil(undefined)).toBe(999)
  })
})

describe('today', () => {
  it('returns a string matching YYYY-MM-DD format', () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('matches the current date', () => {
    const now = new Date()
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    expect(today()).toBe(expected)
  })
})
