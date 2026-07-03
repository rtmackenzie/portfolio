import { describe, it, expect } from 'vitest'
import {
  runMonteCarlo, mulberry32, sampleNormal, sampleCorrelatedNormal, sampleShiftedLognormal, sampleDiscrete,
} from '../../server/services/monteCarlo.ts'
import type { PropertyState } from '../../server/services/scenarioEngine.ts'

function makeState(overrides: Partial<PropertyState> = {}): PropertyState {
  return {
    id: 1, value: 200000, monthly_rent: 1200, monthly_mortgage: 600, monthly_other_expenses: 100,
    debt: 120000, is_vacant: false, mortgage_rate: 5.5, is_interest_only: false, purchase_price: 150000,
    ...overrides,
  }
}
function makeMap(...states: PropertyState[]): Map<number, PropertyState> {
  return new Map(states.map(s => [s.id, s]))
}
const CONFIG = { base_date: '2026-01-01', projection_years: 5, assumptions_json: JSON.stringify({ void_months_per_year: 0, arrears_pct: 0 }) }

describe('mulberry32', () => {
  it('is deterministic — same seed produces the same sequence', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })

  it('different seeds produce different sequences', () => {
    const a = mulberry32(1)
    const b = mulberry32(2)
    expect(a()).not.toBe(b())
  })

  it('produces values in [0, 1)', () => {
    const rng = mulberry32(123)
    for (let i = 0; i < 100; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('sampleNormal / sampleCorrelatedNormal', () => {
  it('sampleNormal centres roughly on mu across many draws', () => {
    const rng = mulberry32(7)
    const draws = Array.from({ length: 2000 }, () => sampleNormal(rng, 3.0, 3.5))
    const mean = draws.reduce((s, v) => s + v, 0) / draws.length
    expect(mean).toBeGreaterThan(2.0)
    expect(mean).toBeLessThan(4.0)
  })

  it('sampleCorrelatedNormal produces positively correlated draws when rho > 0', () => {
    const rng = mulberry32(9)
    const pairs = Array.from({ length: 2000 }, () => sampleCorrelatedNormal(rng, 3.0, 3.5, 2.5, 1.5, 0.6))
    const xs = pairs.map(p => p[0])
    const ys = pairs.map(p => p[1])
    const mx = xs.reduce((s, v) => s + v, 0) / xs.length
    const my = ys.reduce((s, v) => s + v, 0) / ys.length
    const cov = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / xs.length
    expect(cov).toBeGreaterThan(0)
  })
})

describe('sampleShiftedLognormal', () => {
  it('never goes negative and never exceeds the cap', () => {
    const rng = mulberry32(3)
    for (let i = 0; i < 500; i++) {
      const v = sampleShiftedLognormal(rng, 1.5, 4)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(4)
    }
  })
})

describe('sampleDiscrete', () => {
  it('only ever returns one of the provided values', () => {
    const rng = mulberry32(11)
    const allowed = new Set([0, 100, 200, 300])
    for (let i = 0; i < 200; i++) {
      const v = sampleDiscrete(rng, [0, 100, 200, 300], [0.2, 0.4, 0.3, 0.1])
      expect(allowed.has(v)).toBe(true)
    }
  })
})

describe('runMonteCarlo', () => {
  it('is deterministic for a given seed', () => {
    const a = runMonteCarlo(makeMap(makeState()), [], CONFIG, { runs: 50, seed: 42 })
    const b = runMonteCarlo(makeMap(makeState()), [], CONFIG, { runs: 50, seed: 42 })
    expect(a.equity_band).toEqual(b.equity_band)
    expect(a.cashflow_band).toEqual(b.cashflow_band)
  })

  it('returns the requested run count and one band entry per month', () => {
    const result = runMonteCarlo(makeMap(makeState()), [], CONFIG, { runs: 30, seed: 1 })
    expect(result.runs).toBe(30)
    expect(result.equity_band.length).toBe(CONFIG.projection_years * 12)
  })

  it('percentile bands are monotonically ordered every month (p10 <= p25 <= p50 <= p75 <= p90)', () => {
    const result = runMonteCarlo(makeMap(makeState()), [], CONFIG, { runs: 100, seed: 5 })
    for (const band of [...result.equity_band, ...result.cashflow_band]) {
      expect(band.p10).toBeLessThanOrEqual(band.p25)
      expect(band.p25).toBeLessThanOrEqual(band.p50)
      expect(band.p50).toBeLessThanOrEqual(band.p75)
      expect(band.p75).toBeLessThanOrEqual(band.p90)
    }
  })

  it('goal_probability is null when no target is supplied', () => {
    const result = runMonteCarlo(makeMap(makeState()), [], CONFIG, { runs: 20, seed: 2 })
    expect(result.goal_probability).toBeNull()
  })

  it('goal_probability is 1 for a trivially low target and 0 for an unreachable one', () => {
    const low = runMonteCarlo(makeMap(makeState()), [], CONFIG, { runs: 100, seed: 2, targetMonthlyIncome: -1000000 })
    expect(low.goal_probability).toBe(1)
    const high = runMonteCarlo(makeMap(makeState()), [], CONFIG, { runs: 100, seed: 2, targetMonthlyIncome: 100000000 })
    expect(high.goal_probability).toBe(0)
  })
})
