import { describe, it, expect } from 'vitest'
import { computeInsights } from '../../server/services/insights.ts'
import type { ScorecardInputs } from '../../server/services/scorecard.ts'

const TODAY = '2026-06-28'

// A comfortable, low-risk portfolio: well-let, low LTV, fixed-long debt, spread.
function healthyInputs(over: Partial<ScorecardInputs> = {}): ScorecardInputs {
  return {
    properties: [
      { current_value: 250000, purchase_price: 180000, property_type: 'house', town: 'Leeds' },
      { current_value: 250000, purchase_price: 190000, property_type: 'flat', town: 'Sheffield' },
    ],
    mortgages: [
      { current_balance: 120000, monthly_payment: 500, interest_rate: 3.5, type: 'fixed', fixed_period_end: '2031-01-01', is_active: 1 },
    ],
    tenants: [
      { status: 'active', rent_amount: 1400, tenancy_end: null },
      { status: 'active', rent_amount: 1350, tenancy_end: null },
    ],
    expenses: [{ amount: 200, frequency: 'monthly', active: 1 }],
    certificates: [{ expiry_date: '2031-01-01' }],
    openMaintenance: 0,
    rentPayments: [{ status: 'paid' }, { status: 'paid' }, { status: 'paid' }],
    opportunities: [],
    today: TODAY,
    ...over,
  }
}

const find = (r: ReturnType<typeof computeInsights>, cat: string) => r.insights.find(i => i.category === cat)

describe('computeInsights — structure & safety', () => {
  it('always returns a non-empty, generated result', () => {
    const r = computeInsights(healthyInputs())
    expect(r.insights.length).toBeGreaterThan(0)
    expect(typeof r.generated).toBe('string')
  })

  it('an empty portfolio yields a single info prompt, no NaNs', () => {
    const r = computeInsights({
      properties: [], mortgages: [], tenants: [], expenses: [], certificates: [],
      openMaintenance: 0, rentPayments: [], opportunities: [], today: TODAY,
    })
    expect(r.insights).toHaveLength(1)
    expect(r.insights[0].tone).toBe('info')
    expect(JSON.stringify(r)).not.toContain('NaN')
  })

  it('orders critical/warning ahead of positive', () => {
    const r = computeInsights(healthyInputs({
      certificates: [{ expiry_date: '2020-01-01' }],   // expired ⇒ compliance warning/critical
    }))
    const order = { critical: 0, warning: 1, info: 2, positive: 3 } as const
    for (let i = 1; i < r.insights.length; i++) {
      expect(order[r.insights[i].tone]).toBeGreaterThanOrEqual(order[r.insights[i - 1].tone])
    }
  })
})

describe('computeInsights — themed insights cite the numbers', () => {
  it('a healthy portfolio produces a positive summary and no warnings', () => {
    const r = computeInsights(healthyInputs())
    expect(r.insights.some(i => i.tone === 'warning' || i.tone === 'critical')).toBe(false)
    expect(find(r, 'summary')?.tone).toBe('positive')
  })

  it('concentration fires for a single-town, single-type book and cites the %', () => {
    const r = computeInsights(healthyInputs({
      properties: [
        { current_value: 250000, purchase_price: 180000, property_type: 'house', town: 'Leeds' },
        { current_value: 250000, purchase_price: 190000, property_type: 'house', town: 'Leeds' },
      ],
    }))
    const c = find(r, 'concentration')
    expect(c).toBeTruthy()
    expect(c!.detail).toMatch(/Leeds/)
    expect(c!.detail).toMatch(/%/)
  })

  it('refix fires for tracker / soon-expiring debt', () => {
    const r = computeInsights(healthyInputs({
      mortgages: [{ current_balance: 150000, monthly_payment: 800, interest_rate: 5.5, type: 'tracker', fixed_period_end: null, is_active: 1 }],
    }))
    expect(find(r, 'refix')).toBeTruthy()
  })

  it('fragility fires on a thin DSCR / margin', () => {
    const r = computeInsights(healthyInputs({
      mortgages: [{ current_balance: 300000, monthly_payment: 2600, interest_rate: 6, type: 'fixed', fixed_period_end: '2031-01-01', is_active: 1 }],
    }))
    const f = find(r, 'fragility')
    expect(f).toBeTruthy()
    expect(['warning', 'critical']).toContain(f!.tone)
  })

  it('compliance fires on an expired certificate', () => {
    const r = computeInsights(healthyInputs({ certificates: [{ expiry_date: '2020-01-01' }] }))
    expect(find(r, 'compliance')).toBeTruthy()
  })

  it('headroom is a positive insight when there is releasable equity', () => {
    const r = computeInsights(healthyInputs({ mortgages: [] }))   // unleveraged ⇒ lots of headroom
    const h = find(r, 'headroom')
    expect(h?.tone).toBe('positive')
    expect(h!.detail).toMatch(/£/)
  })
})
