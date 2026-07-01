import { describe, it, expect } from 'vitest'
import { briefRiskMetrics } from '../../src/utils/briefMetrics'
import type { ScenarioResults } from '../../src/types'

function month(over: Partial<ScenarioResults['months'][number]>): ScenarioResults['months'][number] {
  return {
    date: '2030-01', total_value: 400000, total_debt: 200000, total_equity: 200000,
    monthly_cashflow: 1000, cumulative_cashflow: 20000, property_count: 3, monthly_cover_ratio: 1.8, monthly_icr: 160,
    ...over,
  } as ScenarioResults['months'][number]
}

function results(over: Partial<ScenarioResults['summary']>, months: ScenarioResults['months']): ScenarioResults {
  return {
    months,
    summary: {
      start_equity: 100000, end_equity: 500000, equity_growth: 400000, equity_growth_pct: 400,
      total_cashflow: 50000, avg_monthly_cashflow: 1000, ending_monthly_cashflow: 2000,
      min_cover_ratio: 1.4, months_below_cover: 3, min_icr: 140, months_below_icr: 3, min_cumulative_cashflow: -5000,
      ...over,
    } as ScenarioResults['summary'],
  } as ScenarioResults
}

describe('briefRiskMetrics', () => {
  it('passes through summary risk fields', () => {
    const r = briefRiskMetrics(results({}, [month({})]))
    expect(r.minIcr).toBe(140)
    expect(r.breaches).toBe(3)
    expect(r.liquidityTrough).toBe(-5000)
  })

  it('peak LTV picks the worst month (highest debt/value)', () => {
    const r = briefRiskMetrics(results({}, [
      month({ total_value: 400000, total_debt: 200000 }), // 50%
      month({ total_value: 400000, total_debt: 320000 }), // 80% ← peak
      month({ total_value: 500000, total_debt: 250000 }), // 50%
    ]))
    expect(r.peakLtv).toBe(80)
  })

  it('is zero-safe when a month has no value', () => {
    const r = briefRiskMetrics(results({}, [month({ total_value: 0, total_debt: 0 })]))
    expect(r.peakLtv).toBe(0)
  })
})
