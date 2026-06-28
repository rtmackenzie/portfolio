import { describe, it, expect } from 'vitest'
import { computeRiskHeatmap } from '../../server/services/risk.ts'
import type { ScorecardInputs } from '../../server/services/scorecard.ts'

const TODAY = '2026-06-28'

function baseInputs(over: Partial<ScorecardInputs> = {}): ScorecardInputs {
  return {
    properties: [
      { current_value: 200000, purchase_price: 160000, property_type: 'house', town: 'Leeds' },
      { current_value: 200000, purchase_price: 170000, property_type: 'flat', town: 'Sheffield' },
    ],
    mortgages: [
      { current_balance: 100000, monthly_payment: 500, interest_rate: 4, type: 'fixed', fixed_period_end: '2030-01-01', is_active: 1 },
    ],
    tenants: [
      { status: 'active', rent_amount: 1200, tenancy_end: null },
      { status: 'active', rent_amount: 1100, tenancy_end: null },
    ],
    expenses: [{ amount: 200, frequency: 'monthly', active: 1 }],
    certificates: [{ expiry_date: '2030-01-01' }],
    openMaintenance: 0,
    rentPayments: [{ status: 'paid' }, { status: 'paid' }, { status: 'paid' }],
    opportunities: [],
    today: TODAY,
    ...over,
  }
}

const factor = (inp: ScorecardInputs, key: string) => computeRiskHeatmap(inp).factors.find(f => f.key === key)!

describe('computeRiskHeatmap — structure & bounds', () => {
  it('returns the seven factors with valid 1–5 likelihood/impact and severity = L×I', () => {
    const { factors } = computeRiskHeatmap(baseInputs())
    expect(factors.map(f => f.key)).toEqual([
      'interest_rate', 'liquidity', 'void', 'arrears', 'concentration', 'compliance', 'leverage',
    ])
    for (const f of factors) {
      expect(f.likelihood).toBeGreaterThanOrEqual(1)
      expect(f.likelihood).toBeLessThanOrEqual(5)
      expect(f.impact).toBeGreaterThanOrEqual(1)
      expect(f.impact).toBeLessThanOrEqual(5)
      expect(f.severity).toBe(f.likelihood * f.impact)
      expect(['low', 'medium', 'high', 'critical']).toContain(f.band)
    }
  })

  it('is NaN-free on an empty portfolio', () => {
    const { factors } = computeRiskHeatmap({
      properties: [], mortgages: [], tenants: [], expenses: [], certificates: [],
      openMaintenance: 0, rentPayments: [], opportunities: [], today: TODAY,
    })
    for (const f of factors) {
      expect(Number.isNaN(f.likelihood)).toBe(false)
      expect(Number.isNaN(f.impact)).toBe(false)
    }
  })
})

describe('factor monotonicity (data-driven)', () => {
  it('all-tracker debt is more rate-exposed than all-fixed-long', () => {
    const tracker = factor(baseInputs({
      mortgages: [{ current_balance: 100000, monthly_payment: 500, interest_rate: 4, type: 'tracker', fixed_period_end: null, is_active: 1 }],
    }), 'interest_rate')
    const fixed = factor(baseInputs(), 'interest_rate')
    expect(tracker.likelihood).toBeGreaterThan(fixed.likelihood)
  })

  it('expired certificates raise compliance likelihood', () => {
    const bad = factor(baseInputs({ certificates: [{ expiry_date: '2020-01-01' }, { expiry_date: '2020-01-01' }] }), 'compliance')
    const ok = factor(baseInputs(), 'compliance')
    expect(bad.likelihood).toBeGreaterThan(ok.likelihood)
    expect(bad.severity).toBeGreaterThan(ok.severity)
  })

  it('high LTV raises leverage risk', () => {
    const high = factor(baseInputs({
      mortgages: [{ current_balance: 360000, monthly_payment: 1800, interest_rate: 5, type: 'fixed', fixed_period_end: '2030-01-01', is_active: 1 }],
    }), 'leverage')
    const low = factor(baseInputs(), 'leverage')
    expect(high.likelihood).toBeGreaterThan(low.likelihood)
  })

  it('a single-town/single-type book is more concentrated', () => {
    const conc = factor(baseInputs({
      properties: [
        { current_value: 200000, purchase_price: 160000, property_type: 'house', town: 'Leeds' },
        { current_value: 200000, purchase_price: 170000, property_type: 'house', town: 'Leeds' },
      ],
    }), 'concentration')
    const spread = factor(baseInputs(), 'concentration')
    expect(conc.severity).toBeGreaterThan(spread.severity)
  })

  it('thin DSCR raises liquidity likelihood', () => {
    const thin = factor(baseInputs({
      mortgages: [{ current_balance: 200000, monthly_payment: 2200, interest_rate: 6, type: 'fixed', fixed_period_end: '2030-01-01', is_active: 1 }],
    }), 'liquidity')
    const healthy = factor(baseInputs(), 'liquidity')
    expect(thin.likelihood).toBeGreaterThan(healthy.likelihood)
  })

  it('a tenant on notice raises void likelihood', () => {
    const notice = factor(baseInputs({
      tenants: [{ status: 'active', rent_amount: 1200, tenancy_end: null }, { status: 'notice_given', rent_amount: 1100, tenancy_end: null }],
    }), 'void')
    const full = factor(baseInputs(), 'void')
    expect(notice.likelihood).toBeGreaterThanOrEqual(full.likelihood)
    expect(notice.severity).toBeGreaterThan(full.severity)
  })

  it('missed rent raises arrears likelihood', () => {
    const arrears = factor(baseInputs({
      rentPayments: [{ status: 'missed' }, { status: 'late' }, { status: 'paid' }, { status: 'paid' }],
    }), 'arrears')
    const clean = factor(baseInputs(), 'arrears')
    expect(arrears.likelihood).toBeGreaterThan(clean.likelihood)
  })
})
