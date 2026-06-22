import { describe, it, expect } from 'vitest'
import { formatCurrency, formatPercent, formatNumber } from '../../src/utils/currency.ts'

describe('formatCurrency', () => {
  it('formats whole pounds with £ symbol', () => {
    expect(formatCurrency(1000)).toBe('£1,000')
  })

  it('rounds to nearest pound', () => {
    expect(formatCurrency(1000.7)).toBe('£1,001')
    expect(formatCurrency(1000.3)).toBe('£1,000')
  })

  it('formats negative amounts', () => {
    expect(formatCurrency(-500)).toBe('-£500')
  })

  it('formats zero', () => {
    expect(formatCurrency(0)).toBe('£0')
  })

  describe('compact mode', () => {
    it('renders thousands as k', () => {
      expect(formatCurrency(235000, true)).toBe('£235.0k')
    })

    it('renders millions as m', () => {
      expect(formatCurrency(1500000, true)).toBe('£1.50m')
    })

    it('renders values under 1000 without suffix', () => {
      expect(formatCurrency(850, true)).toBe('£850')
    })

    it('handles negative thousands', () => {
      expect(formatCurrency(-120000, true)).toBe('£-120.0k')
    })
  })
})

describe('formatPercent', () => {
  it('formats with 1 decimal place by default', () => {
    expect(formatPercent(6.153)).toBe('6.2%')
  })

  it('respects custom decimal places', () => {
    expect(formatPercent(6.153, 2)).toBe('6.15%')
    expect(formatPercent(6.153, 0)).toBe('6%')
  })

  it('formats zero', () => {
    expect(formatPercent(0)).toBe('0.0%')
  })

  it('formats negative values', () => {
    expect(formatPercent(-3.5)).toBe('-3.5%')
  })
})

describe('formatNumber', () => {
  it('formats with thousands separator', () => {
    expect(formatNumber(1234567)).toBe('1,234,567')
  })

  it('formats small numbers without separator', () => {
    expect(formatNumber(42)).toBe('42')
  })

  it('formats zero', () => {
    expect(formatNumber(0)).toBe('0')
  })
})
