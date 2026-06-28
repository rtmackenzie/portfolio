import { describe, it, expect } from 'vitest'
import { computeScorecard, type ScorecardInputs } from '../../server/services/scorecard.ts'

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

const get = (sc: ReturnType<typeof computeScorecard>, key: string) => sc.scores.find(s => s.key === key)!

describe('computeScorecard — bounds & safety', () => {
  it('every score is an integer within [0,100], including the overall', () => {
    const sc = computeScorecard(baseInputs())
    for (const s of [...sc.scores, sc.overall]) {
      expect(Number.isInteger(s.value)).toBe(true)
      expect(s.value).toBeGreaterThanOrEqual(0)
      expect(s.value).toBeLessThanOrEqual(100)
    }
  })

  it('an empty portfolio yields no NaNs', () => {
    const sc = computeScorecard({
      properties: [], mortgages: [], tenants: [], expenses: [], certificates: [],
      openMaintenance: 0, rentPayments: [], opportunities: [], today: TODAY,
    })
    for (const s of [...sc.scores, sc.overall]) expect(Number.isNaN(s.value)).toBe(false)
  })

  it('returns the six named scores', () => {
    const keys = computeScorecard(baseInputs()).scores.map(s => s.key)
    expect(keys).toEqual(['health', 'liquidity', 'rate_resilience', 'vacancy', 'diversification', 'opportunity'])
  })
})

describe('Health', () => {
  it('drops with expired certs, missed rent and open maintenance', () => {
    const clean = get(computeScorecard(baseInputs()), 'health').value
    const poor = get(computeScorecard(baseInputs({
      certificates: [{ expiry_date: '2020-01-01' }, { expiry_date: '2020-01-01' }],
      openMaintenance: 3,
      rentPayments: [{ status: 'missed' }, { status: 'late' }, { status: 'paid' }, { status: 'paid' }],
    })), 'health').value
    expect(poor).toBeLessThan(clean)
  })
})

describe('Liquidity', () => {
  it('higher DSCR scores higher', () => {
    const low = get(computeScorecard(baseInputs({
      mortgages: [{ current_balance: 200000, monthly_payment: 2000, interest_rate: 6, type: 'fixed', fixed_period_end: '2030-01-01', is_active: 1 }],
    })), 'liquidity').value
    const high = get(computeScorecard(baseInputs({
      mortgages: [{ current_balance: 80000, monthly_payment: 400, interest_rate: 3, type: 'fixed', fixed_period_end: '2030-01-01', is_active: 1 }],
    })), 'liquidity').value
    expect(high).toBeGreaterThan(low)
  })
})

describe('Rate-resilience', () => {
  it('all-fixed-long beats all-tracker', () => {
    const fixed = get(computeScorecard(baseInputs({
      mortgages: [{ current_balance: 100000, monthly_payment: 500, interest_rate: 4, type: 'fixed', fixed_period_end: '2030-01-01', is_active: 1 }],
    })), 'rate_resilience').value
    const tracker = get(computeScorecard(baseInputs({
      mortgages: [{ current_balance: 100000, monthly_payment: 500, interest_rate: 4, type: 'tracker', fixed_period_end: null, is_active: 1 }],
    })), 'rate_resilience').value
    expect(fixed).toBeGreaterThan(tracker)
  })

  it('is 100 with no debt', () => {
    expect(get(computeScorecard(baseInputs({ mortgages: [] })), 'rate_resilience').value).toBe(100)
  })
})

describe('Vacancy', () => {
  it('drops when a tenant is on notice', () => {
    const full = get(computeScorecard(baseInputs()), 'vacancy').value
    const notice = get(computeScorecard(baseInputs({
      tenants: [{ status: 'active', rent_amount: 1200, tenancy_end: null }, { status: 'notice_given', rent_amount: 1100, tenancy_end: null }],
    })), 'vacancy').value
    expect(notice).toBeLessThan(full)
  })
})

describe('Diversification', () => {
  it('a spread portfolio beats a single-type/single-town one', () => {
    const spread = get(computeScorecard(baseInputs()), 'diversification').value
    const concentrated = get(computeScorecard(baseInputs({
      properties: [
        { current_value: 200000, purchase_price: 160000, property_type: 'house', town: 'Leeds' },
        { current_value: 200000, purchase_price: 170000, property_type: 'house', town: 'Leeds' },
      ],
    })), 'diversification').value
    expect(spread).toBeGreaterThan(concentrated)
  })
})

describe('Opportunity', () => {
  it('rises with LTV headroom and a qualified pipeline deal', () => {
    const lowHeadroom = get(computeScorecard(baseInputs({
      mortgages: [{ current_balance: 290000, monthly_payment: 1400, interest_rate: 5, type: 'fixed', fixed_period_end: '2030-01-01', is_active: 1 }],
    })), 'opportunity').value
    const highHeadroom = get(computeScorecard(baseInputs({
      mortgages: [],
      opportunities: [{ stage: 'offer_made', asking_price: 150000, estimated_value: 175000, expected_rent: 1000, repair_costs: 0, deposit_percent: 25, mortgage_rate: 5 }],
    })), 'opportunity').value
    expect(highHeadroom).toBeGreaterThan(lowHeadroom)
  })
})

describe('Overall', () => {
  it('is the documented weighted blend of the six scores', () => {
    const sc = computeScorecard(baseInputs())
    const W: Record<string, number> = { health: 0.2, liquidity: 0.2, rate_resilience: 0.2, vacancy: 0.15, diversification: 0.15, opportunity: 0.1 }
    const expected = Math.round(sc.scores.reduce((s, x) => s + x.value * W[x.key], 0))
    expect(sc.overall.value).toBe(expected)
  })
})
