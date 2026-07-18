import { describe, it, expect } from 'vitest'
import { deriveMetrics, COMPARE_ROWS, winnerIndex } from '../../src/components/shared/ScenarioCompareTable'
import type { ScenarioResults } from '../../src/types'

function month(over: Partial<ScenarioResults['months'][number]> = {}): ScenarioResults['months'][number] {
  return {
    date: '2030-01', total_value: 400000, total_debt: 200000, total_equity: 200000,
    monthly_cashflow: 1000, cumulative_cashflow: 20000, property_count: 3,
    monthly_cover_ratio: 1.8, monthly_icr: 160,
    ...over,
  } as ScenarioResults['months'][number]
}

function results(
  over: Partial<ScenarioResults['summary']> = {},
  months: ScenarioResults['months'] = [month()]
): ScenarioResults {
  return {
    months,
    summary: {
      start_equity: 100000, end_equity: 500000, equity_growth: 400000, equity_growth_pct: 400,
      total_cashflow: 50000, avg_monthly_cashflow: 1000, ending_monthly_cashflow: 2000,
      min_cover_ratio: 1.4, months_below_cover: 3, min_icr: 140, months_below_icr: 3,
      min_cumulative_cashflow: -5000,
      ...over,
    } as ScenarioResults['summary'],
  } as ScenarioResults
}

const rowFor = (key: string) => COMPARE_ROWS.find(r => r.key === key)!

describe('deriveMetrics — projection length', () => {
  it('reports the number of months actually projected', () => {
    const m = deriveMetrics(results({}, Array.from({ length: 180 }, () => month())), 0)!
    expect(m.projection_months).toBe(180)
  })

  it('renders as whole years when the horizon divides evenly', () => {
    const row = rowFor('projection_months')
    expect(row.format(180)).toBe('15y')
    expect(row.format(120)).toBe('10y')
    expect(row.format(18)).toBe('1y 6mo')
  })

  it('never marks a winner — a longer horizon is different, not better', () => {
    expect(rowFor('projection_months').bestHighest).toBeNull()
  })

  it('surfaces mismatched horizons between scenarios', () => {
    const short = deriveMetrics(results({}, Array.from({ length: 120 }, () => month())), 0)!
    const long = deriveMetrics(results({}, Array.from({ length: 180 }, () => month())), 0)!
    expect(short.projection_months).not.toBe(long.projection_months)
  })
})

describe('deriveMetrics — ending monthly cashflow', () => {
  it('passes through the pre-tax ending figure', () => {
    const m = deriveMetrics(results({ ending_monthly_cashflow: 2400 }), 0)!
    expect(m.ending_monthly_cf).toBe(2400)
  })

  it('passes through the post-tax ending figure when present', () => {
    const m = deriveMetrics(results({ ending_monthly_cashflow: 2400, ending_monthly_cashflow_posttax: 1850 }), 0)!
    expect(m.ending_monthly_cf).toBe(2400)
    expect(m.ending_monthly_cf_posttax).toBe(1850)
  })

  it('falls back to the pre-tax figure when no post-tax value exists', () => {
    // Older stored results predate the post-tax fields; showing 0 would imply a 100% tax rate.
    const m = deriveMetrics(results({ ending_monthly_cashflow: 2400, ending_monthly_cashflow_posttax: undefined }), 0)!
    expect(m.ending_monthly_cf_posttax).toBe(2400)
  })

  it('treats a missing pre-tax figure as 0 rather than NaN', () => {
    const m = deriveMetrics(results({ ending_monthly_cashflow: undefined as never }), 0)!
    expect(m.ending_monthly_cf).toBe(0)
    expect(Number.isNaN(m.ending_monthly_cf)).toBe(false)
  })

  it('picks the highest ending cashflow as the winner', () => {
    const a = deriveMetrics(results({ ending_monthly_cashflow: 1200 }), 0)
    const b = deriveMetrics(results({ ending_monthly_cashflow: 3100 }), 0)
    const c = deriveMetrics(results({ ending_monthly_cashflow: 2000 }), 0)
    expect(winnerIndex([a, b, c], 'ending_monthly_cf', true)).toBe(1)
  })

  it('ignores scenarios with no results when picking a winner', () => {
    const a = deriveMetrics(results({ ending_monthly_cashflow: 1200 }), 0)
    expect(winnerIndex([null, a], 'ending_monthly_cf', true)).toBe(1)
  })
})

describe('deriveMetrics — null results', () => {
  it('returns null so the column can render as "no run"', () => {
    expect(deriveMetrics(null, 0)).toBeNull()
  })
})
