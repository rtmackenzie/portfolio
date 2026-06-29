// Plain-English insights (Epic D3). A narrative layer over the D1 scorecard and
// D2 risk heatmap — it reads the same structured signals and the portfolio KPIs,
// then emits prioritised sentences that cite the real numbers. Pure + tested.
// Templated today; `renderInsights` exposes an LLM seam for a future Claude rewrite.

import { calculatePortfolioKPIs } from './calculations.ts'
import { computeScorecard, type ScorecardInputs } from './scorecard.ts'
import { computeRiskHeatmap, type RiskBand } from './risk.ts'

export type InsightTone = 'positive' | 'info' | 'warning' | 'critical'

export interface Insight {
  id: string
  category: string
  tone: InsightTone
  headline: string
  detail: string
  metrics?: { label: string; value: string }[]
}

export interface InsightsResult {
  insights: Insight[]
  generated: string
}

const gbp = (n: number) => '£' + Math.round(n).toLocaleString()
const pct = (n: number) => `${Math.round(n)}%`

const TONE_ORDER: Record<InsightTone, number> = { critical: 0, warning: 1, info: 2, positive: 3 }
const toneFromBand = (b: RiskBand): InsightTone =>
  b === 'critical' ? 'critical' : b === 'high' ? 'warning' : b === 'medium' ? 'info' : 'positive'

// Material risk factors → narrative insights (emit when band is medium or worse)
const RISK_NARRATIVE: Record<string, { category: string; headline: string }> = {
  interest_rate: { category: 'refix', headline: 'Interest-rate exposure' },
  liquidity: { category: 'fragility', headline: 'Cashflow fragility' },
  concentration: { category: 'concentration', headline: 'Concentration risk' },
  compliance: { category: 'compliance', headline: 'Compliance gap' },
  void: { category: 'vacancy', headline: 'Void exposure' },
  arrears: { category: 'arrears', headline: 'Rent arrears' },
  leverage: { category: 'leverage', headline: 'Leverage' },
}

export function computeInsights(inp: ScorecardInputs): InsightsResult {
  const generated = (inp.today ? new Date(inp.today) : new Date()).toISOString()
  const kpis = calculatePortfolioKPIs(inp.properties, inp.mortgages, inp.tenants, inp.expenses)
  const props = inp.properties.length

  if (props === 0) {
    return { insights: [{ id: 'empty', category: 'summary', tone: 'info', headline: 'No portfolio data yet', detail: 'Add properties, tenancies and mortgages to see plain-English insights here.' }], generated }
  }

  const sc = computeScorecard(inp)
  const risk = computeRiskHeatmap(inp)
  const riskMap = new Map(risk.factors.map(f => [f.key, f]))

  const active = inp.mortgages.filter(m => m.is_active === 1)
  const mortgagePayments = active.reduce((s, m) => s + m.monthly_payment, 0)
  const totalBalance = active.reduce((s, m) => s + m.current_balance, 0)
  const dscr = mortgagePayments > 0 ? kpis.monthly_gross_income / mortgagePayments : Infinity
  const totalValue = kpis.total_portfolio_value

  const insights: Insight[] = []

  // Risk-derived narrative (concentration, refix, fragility, compliance, …)
  for (const [key, meta] of Object.entries(RISK_NARRATIVE)) {
    const rf = riskMap.get(key)
    if (!rf || rf.band === 'low') continue
    insights.push({
      id: key,
      category: meta.category,
      tone: toneFromBand(rf.band),
      headline: meta.headline,
      detail: `${rf.rationale} ${rf.mitigation}`,
    })
  }

  // Headroom (opportunity) — releasable equity to 75% LTV
  const headroom = Math.max(0, 0.75 * totalValue - kpis.total_debt)
  const avgValue = totalValue / props
  const oneDeposit = 0.25 * avgValue
  const deposits = oneDeposit > 0 ? headroom / oneDeposit : 0
  if (deposits >= 1) {
    insights.push({
      id: 'headroom', category: 'headroom', tone: 'positive', headline: 'Acquisition headroom',
      detail: `${gbp(headroom)} of equity is releasable to 75% LTV — roughly ${Math.floor(deposits)} more purchase(s) at today's average price of ${gbp(avgValue)}.`,
      metrics: [{ label: 'Releasable equity', value: gbp(headroom) }, { label: 'LTV', value: pct(kpis.ltv_ratio) }],
    })
  } else if (totalBalance > 0 && kpis.ltv_ratio > 70) {
    insights.push({
      id: 'headroom', category: 'headroom', tone: 'info', headline: 'Limited borrowing headroom',
      detail: `Portfolio LTV is ${pct(kpis.ltv_ratio)}, leaving little releasable equity below 75% — fresh acquisitions would need new cash rather than recycled equity.`,
    })
  }

  // Performance — gross yield vs a 6% benchmark
  if (kpis.annual_gross_yield >= 6) {
    insights.push({
      id: 'performance', category: 'performance', tone: 'positive', headline: 'Strong gross yield',
      detail: `Portfolio gross yield is ${kpis.annual_gross_yield.toFixed(1)}%, above the ~6% market benchmark.`,
    })
  } else if (kpis.annual_gross_yield > 0 && kpis.annual_gross_yield < 5) {
    insights.push({
      id: 'performance', category: 'performance', tone: 'info', headline: 'Yield below benchmark',
      detail: `Portfolio gross yield is ${kpis.annual_gross_yield.toFixed(1)}%, below the ~6% benchmark — review rents at renewal.`,
    })
  }

  // Positive summary when nothing material is wrong
  const hasWarning = insights.some(i => i.tone === 'warning' || i.tone === 'critical')
  if (!hasWarning) {
    insights.push({
      id: 'summary', category: 'summary', tone: 'positive', headline: 'Portfolio looks healthy',
      detail: `Overall score ${sc.overall.value}/100, DSCR ${dscr === Infinity ? '∞' : dscr.toFixed(2)}×, LTV ${pct(kpis.ltv_ratio)} — no pressing risks flagged.`,
    })
  }

  const catPriority = ['fragility', 'refix', 'compliance', 'concentration', 'leverage', 'vacancy', 'arrears', 'headroom', 'performance', 'summary']
  insights.sort((a, b) =>
    TONE_ORDER[a.tone] - TONE_ORDER[b.tone]
    || catPriority.indexOf(a.category) - catPriority.indexOf(b.category))

  return { insights, generated }
}

// LLM seam — returns the templated result today. A future implementation can,
// when `llm` is enabled, send these grounded insights to Claude for a fluent
// rewrite under a strict "never invent or alter numbers" instruction.
export async function renderInsights(
  inp: ScorecardInputs,
  opts?: { llm?: boolean }
): Promise<InsightsResult> {
  const templated = computeInsights(inp)
  const useLlm = opts?.llm ?? process.env.INSIGHTS_LLM === '1'
  if (!useLlm) return templated
  // TODO: Anthropic rewrite of `templated.insights` (grounded; numbers preserved).
  return templated
}
