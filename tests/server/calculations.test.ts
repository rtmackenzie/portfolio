import { describe, it, expect } from 'vitest'
import {
  calcLBTT,
  calcADS,
  calcTransactionCosts,
  calculatePropertyFinancials,
  calculateAcquisitionMetrics,
  calculatePortfolioKPIs,
} from '../../server/services/calculations.ts'

// ─── calcLBTT / calcADS / calcTransactionCosts ───────────────────────────────

describe('calcLBTT', () => {
  it('returns 0 for £0', () => expect(calcLBTT(0)).toBe(0))
  it('returns 0 below £145k threshold (additional dwelling)', () => expect(calcLBTT(66000)).toBe(0))
  it('applies 2% band: £200k → (200k−145k) × 2% = £1,100', () => expect(calcLBTT(200000)).toBe(1100))
  it('applies 2% + 5% bands: £300k → (250k−145k)×2% + (300k−250k)×5% = £4,600', () => expect(calcLBTT(300000)).toBe(4600))
  it('applies all bands up to 10%: £400k → 2100+3750+7500 = £13,350', () => expect(calcLBTT(400000)).toBe(13350))
})

describe('calcADS', () => {
  it('returns 0 for property ≤ £40k', () => expect(calcADS(40000)).toBe(0))
  it('returns 8% of full price for £66k', () => expect(calcADS(66000)).toBe(5280))
  it('returns 8% of full price for £200k', () => expect(calcADS(200000)).toBe(16000))
})

describe('calcTransactionCosts', () => {
  it('£66k with default fees: LBTT=0, ADS=5280, fees=2000, total=7280', () => {
    const result = calcTransactionCosts(66000)
    expect(result).toEqual({ lbtt: 0, ads: 5280, fees: 2000, total: 7280 })
  })
  it('£200k with £1500 legal, £5000 refurb: total = 1100+16000+6500 = 23600', () => {
    const result = calcTransactionCosts(200000, 1500, 5000)
    expect(result.total).toBe(23600)
  })
  it('£0 purchase returns all zeros', () => {
    const result = calcTransactionCosts(0)
    expect(result).toEqual({ lbtt: 0, ads: 0, fees: 2000, total: 2000 })
  })
})

// ─── calculatePropertyFinancials ─────────────────────────────────────────────

describe('calculatePropertyFinancials', () => {
  const property = { purchase_price: 150000, current_value: 200000 }
  const tenant = { rent_amount: 1000 }
  const mortgage = { monthly_payment: 500, current_balance: 120000, original_amount: 112500 }
  const expenses = [
    { amount: 50, frequency: 'monthly' },   // £50/mo
    { amount: 120, frequency: 'quarterly' }, // £40/mo
    { amount: 240, frequency: 'annually' },  // £20/mo
  ]

  it('computes gross yield from current value', () => {
    const r = calculatePropertyFinancials(property, tenant, mortgage, [])
    // (1000 * 12) / 200000 = 6%
    expect(r.gross_yield).toBeCloseTo(6, 1)
  })

  it('normalises mixed expense frequencies to monthly', () => {
    const r = calculatePropertyFinancials(property, tenant, mortgage, expenses)
    // 50 + 40 + 20 = £110/mo
    expect(r.monthly_other_expenses).toBeCloseTo(110, 1)
  })

  it('net cashflow = rent − mortgage − other expenses', () => {
    const r = calculatePropertyFinancials(property, tenant, mortgage, expenses)
    expect(r.monthly_net_cashflow).toBeCloseTo(1000 - 500 - 110, 1)
  })

  it('equity = current value − debt', () => {
    const r = calculatePropertyFinancials(property, tenant, mortgage, [])
    expect(r.equity).toBe(200000 - 120000)
  })

  it('LTV = debt / value × 100', () => {
    const r = calculatePropertyFinancials(property, tenant, mortgage, [])
    // 120000 / 200000 = 60%
    expect(r.ltv).toBeCloseTo(60, 1)
  })

  it('ROI uses deposit paid (purchase − original mortgage)', () => {
    const r = calculatePropertyFinancials(property, tenant, mortgage, expenses)
    const depositPaid = 150000 - 112500 // £37,500
    const annualNet = r.monthly_net_cashflow * 12
    expect(r.annual_roi).toBeCloseTo((annualNet / depositPaid) * 100, 1)
  })

  it('falls back to purchase_price when current_value is null', () => {
    const r = calculatePropertyFinancials({ purchase_price: 150000, current_value: null }, tenant, mortgage, [])
    expect(r.gross_yield).toBeCloseTo((1000 * 12 / 150000) * 100, 1)
  })

  it('handles no tenant (vacant property)', () => {
    const r = calculatePropertyFinancials(property, null, mortgage, [])
    expect(r.monthly_gross_income).toBe(0)
    expect(r.monthly_net_cashflow).toBe(-500) // still paying mortgage
  })

  it('handles no mortgage', () => {
    const r = calculatePropertyFinancials(property, tenant, null, [])
    expect(r.monthly_mortgage).toBe(0)
    expect(r.ltv).toBe(0)
    expect(r.equity).toBe(200000)
  })

  it('returns zero yield when value is zero', () => {
    const r = calculatePropertyFinancials({ purchase_price: 0, current_value: 0 }, tenant, null, [])
    expect(r.gross_yield).toBe(0)
    expect(r.net_yield).toBe(0)
  })

  it('excludes once-off expenses from monthly normalisation', () => {
    const r = calculatePropertyFinancials(property, tenant, null, [
      { amount: 5000, frequency: 'once' },
      { amount: 100, frequency: 'monthly' },
    ])
    expect(r.monthly_other_expenses).toBeCloseTo(100, 1)
  })
})

// ─── calculateAcquisitionMetrics ─────────────────────────────────────────────

describe('calculateAcquisitionMetrics', () => {
  const base = {
    asking_price: 200000,
    estimated_value: 210000,
    expected_rent: 1100,
    repair_costs: 5000,
    deposit_percent: 25,
    mortgage_rate: 5.5,
  }

  it('deposit = asking_price × deposit_percent / 100', () => {
    const r = calculateAcquisitionMetrics(base)
    expect(r.deposit_required).toBe(50000)
  })

  it('mortgage_amount = asking_price − deposit', () => {
    const r = calculateAcquisitionMetrics(base)
    expect(r.mortgage_amount).toBe(150000)
  })

  it('monthly_mortgage is interest-only (loan × rate / 12)', () => {
    const r = calculateAcquisitionMetrics(base)
    const expected = (150000 * 0.055) / 12
    expect(r.monthly_mortgage).toBeCloseTo(expected, 2)
  })

  it('gross yield uses estimated_value', () => {
    const r = calculateAcquisitionMetrics(base)
    const expected = (1100 * 12 / 210000) * 100
    expect(r.gross_yield).toBeCloseTo(expected, 1)
  })

  it('total_invested includes repair costs', () => {
    const r = calculateAcquisitionMetrics(base)
    expect(r.total_invested).toBe(50000 + 5000)
  })

  it('potential_equity = estimated_value − asking_price', () => {
    const r = calculateAcquisitionMetrics(base)
    expect(r.potential_equity).toBe(10000)
  })

  it('net_cashflow = rent − monthly_mortgage', () => {
    const r = calculateAcquisitionMetrics(base)
    expect(r.net_cashflow).toBeCloseTo(1100 - r.monthly_mortgage, 2)
  })

  it('defaults to 25% deposit and 5.5% rate when omitted', () => {
    const r = calculateAcquisitionMetrics({ asking_price: 100000, expected_rent: 600 })
    expect(r.deposit_required).toBe(25000)
    expect(r.monthly_mortgage).toBeCloseTo((75000 * 0.055) / 12, 2)
  })

  it('returns zero yield when estimated_value is 0', () => {
    const r = calculateAcquisitionMetrics({ asking_price: 0, estimated_value: 0, expected_rent: 500 })
    expect(r.gross_yield).toBe(0)
  })
})

// ─── calculatePortfolioKPIs ───────────────────────────────────────────────────

describe('calculatePortfolioKPIs', () => {
  const properties = [
    { current_value: 200000, purchase_price: 150000 },
    { current_value: 150000, purchase_price: 130000 },
  ]
  const mortgages = [
    { current_balance: 120000, monthly_payment: 500, is_active: 1 },
    { current_balance: 90000,  monthly_payment: 400, is_active: 1 },
    { current_balance: 50000,  monthly_payment: 250, is_active: 0 }, // inactive — excluded
  ]
  const tenants = [
    { rent_amount: 1000, status: 'active' },
    { rent_amount: 800,  status: 'active' },
    { rent_amount: 700,  status: 'ended' }, // excluded
  ]
  const expenses = [
    { amount: 100, frequency: 'monthly',   active: 1 },
    { amount: 120, frequency: 'quarterly', active: 1 }, // £40/mo
    { amount: 240, frequency: 'annually',  active: 1 }, // £20/mo
    { amount: 500, frequency: 'monthly',   active: 0 }, // inactive — excluded
  ]

  it('sums current_value across all properties', () => {
    const r = calculatePortfolioKPIs(properties, [], [], [])
    expect(r.total_portfolio_value).toBe(350000)
  })

  it('total_debt only includes active mortgages', () => {
    const r = calculatePortfolioKPIs(properties, mortgages, [], [])
    expect(r.total_debt).toBe(120000 + 90000) // 210000
  })

  it('equity = value − active debt', () => {
    const r = calculatePortfolioKPIs(properties, mortgages, [], [])
    expect(r.total_equity).toBe(350000 - 210000)
  })

  it('LTV = debt / value × 100', () => {
    const r = calculatePortfolioKPIs(properties, mortgages, [], [])
    expect(r.ltv_ratio).toBeCloseTo((210000 / 350000) * 100, 1)
  })

  it('income only counts active tenants', () => {
    const r = calculatePortfolioKPIs(properties, [], tenants, [])
    expect(r.monthly_gross_income).toBe(1000 + 800) // 1800
  })

  it('occupancy_rate = active tenants / total properties × 100', () => {
    const r = calculatePortfolioKPIs(properties, [], tenants, [])
    expect(r.occupancy_rate).toBe(100) // 2 active out of 2 properties
  })

  it('monthly_expenses includes active mortgages + normalised expenses', () => {
    const r = calculatePortfolioKPIs(properties, mortgages, [], expenses)
    const expectedMortgages = 500 + 400 // active only
    const expectedOther = 100 + 40 + 20 // monthly + quarterly/3 + annually/12
    expect(r.monthly_expenses).toBeCloseTo(expectedMortgages + expectedOther, 1)
  })

  it('net cashflow = gross income − all expenses', () => {
    const r = calculatePortfolioKPIs(properties, mortgages, tenants, expenses)
    expect(r.monthly_net_cashflow).toBeCloseTo(r.monthly_gross_income - r.monthly_expenses, 1)
  })

  it('annual gross yield = (monthly income × 12) / portfolio value × 100', () => {
    const r = calculatePortfolioKPIs(properties, [], tenants, [])
    const expected = (1800 * 12 / 350000) * 100
    expect(r.annual_gross_yield).toBeCloseTo(expected, 1)
  })

  it('returns zeros for empty portfolio', () => {
    const r = calculatePortfolioKPIs([], [], [], [])
    expect(r.total_portfolio_value).toBe(0)
    expect(r.total_equity).toBe(0)
    expect(r.ltv_ratio).toBe(0)
    expect(r.annual_gross_yield).toBe(0)
    expect(r.occupancy_rate).toBe(0)
  })

  it('falls back to purchase_price when current_value is null', () => {
    const r = calculatePortfolioKPIs(
      [{ current_value: null, purchase_price: 180000 }],
      [], [], []
    )
    expect(r.total_portfolio_value).toBe(180000)
  })
})
