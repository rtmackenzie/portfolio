import { describe, it, expect } from 'vitest'
import {
  calcGrossYield,
  calcNetCashflow,
  calcDepositRequired,
  calcMonthlyMortgage,
  calcAcquisitionMetrics,
} from '../../src/utils/calculations.ts'

describe('calcGrossYield', () => {
  it('annual rent / value × 100', () => {
    // £12,000 / £200,000 = 6%
    expect(calcGrossYield(12000, 200000)).toBe(6)
  })

  it('rounds to 1 decimal place', () => {
    // £11,400 / £190,000 = 6.0%
    expect(calcGrossYield(11400, 190000)).toBe(6)
    // £9,500 / £155,000 = 6.129...% → 6.1
    expect(calcGrossYield(9500, 155000)).toBe(6.1)
  })

  it('returns 0 when property value is 0', () => {
    expect(calcGrossYield(12000, 0)).toBe(0)
  })
})

describe('calcNetCashflow', () => {
  it('rent − mortgage − expenses', () => {
    expect(calcNetCashflow(1000, 500, 100)).toBe(400)
  })

  it('returns negative when expenses exceed rent', () => {
    expect(calcNetCashflow(500, 400, 200)).toBe(-100)
  })

  it('handles all zeros', () => {
    expect(calcNetCashflow(0, 0, 0)).toBe(0)
  })
})

describe('calcDepositRequired', () => {
  it('purchase_price × deposit_percent / 100', () => {
    expect(calcDepositRequired(200000, 25)).toBe(50000)
  })

  it('adds repair costs to deposit', () => {
    expect(calcDepositRequired(200000, 25, 5000)).toBe(55000)
  })

  it('defaults repair_costs to 0', () => {
    expect(calcDepositRequired(200000, 25)).toBe(calcDepositRequired(200000, 25, 0))
  })

  it('works with non-standard deposit percentages', () => {
    expect(calcDepositRequired(150000, 15)).toBe(22500)
  })
})

describe('calcMonthlyMortgage', () => {
  it('interest-only: loan × rate / 12', () => {
    // £150,000 at 5.5% → £687.50/mo
    expect(calcMonthlyMortgage(150000, 5.5)).toBeCloseTo(687.5, 2)
  })

  it('handles zero rate', () => {
    expect(calcMonthlyMortgage(150000, 0)).toBe(0)
  })
})

describe('calcAcquisitionMetrics', () => {
  const base = {
    asking_price: 200000,
    estimated_value: 210000,
    expected_rent: 1100,
    repair_costs: 5000,
    deposit_percent: 25,
    mortgage_rate: 5.5,
  }

  it('deposit_required = asking_price × 25% = £50,000', () => {
    expect(calcAcquisitionMetrics(base).deposit_required).toBe(50000)
  })

  it('mortgage_amount = £150,000', () => {
    expect(calcAcquisitionMetrics(base).mortgage_amount).toBe(150000)
  })

  it('gross yield uses estimated_value not asking_price', () => {
    const r = calcAcquisitionMetrics(base)
    const expected = Math.round((1100 * 12 / 210000) * 1000) / 10
    expect(r.gross_yield).toBe(expected)
  })

  it('total_invested = deposit + repair_costs', () => {
    expect(calcAcquisitionMetrics(base).total_invested).toBe(55000)
  })

  it('potential_equity = estimated_value − asking_price', () => {
    expect(calcAcquisitionMetrics(base).potential_equity).toBe(10000)
  })

  it('net_cashflow = rent − monthly_mortgage', () => {
    const r = calcAcquisitionMetrics(base)
    expect(r.net_cashflow).toBeCloseTo(1100 - r.monthly_mortgage, 2)
  })

  it('defaults to 25% deposit and 5.5% rate', () => {
    const r = calcAcquisitionMetrics({ asking_price: 100000, expected_rent: 600 })
    expect(r.deposit_required).toBe(25000)
    expect(r.monthly_mortgage).toBeCloseTo((75000 * 0.055) / 12, 2)
  })

  it('returns zero gross_yield when estimated_value is 0', () => {
    expect(calcAcquisitionMetrics({ asking_price: 0 }).gross_yield).toBe(0)
  })
})
