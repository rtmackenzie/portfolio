import type { ScenarioResults } from '@/types'

export interface BriefRisk {
  minIcr: number
  breaches: number
  liquidityTrough: number
  peakLtv: number
}

// Scenario-level risk metrics derived from a projection result. Pure + tested.
export function briefRiskMetrics(results: ScenarioResults): BriefRisk {
  const { summary, months } = results
  const peakLtv = months.reduce((mx, m) => {
    const ltv = m.total_value > 0 ? (m.total_debt / m.total_value) * 100 : 0
    return Math.max(mx, ltv)
  }, 0)
  return {
    minIcr: summary.min_icr ?? 0,
    breaches: summary.months_below_icr ?? 0,
    liquidityTrough: summary.min_cumulative_cashflow ?? 0,
    peakLtv: Math.round(peakLtv * 10) / 10,
  }
}
