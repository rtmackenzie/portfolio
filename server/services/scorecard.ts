// Portfolio scorecard (Epic D1). Six transparent 0–100 scores (higher = better)
// plus a weighted overall. Pure + unit-tested; the route gathers inputs from the DB.

import { calculatePortfolioKPIs, calculateAcquisitionMetrics } from './calculations.ts'

export type Rating = 'strong' | 'fair' | 'weak'

export interface ScoreItem {
  key: string
  label: string
  value: number          // 0–100, integer
  rating: Rating
  detail: string         // plain-English formula trace
}

export interface Scorecard {
  overall: ScoreItem
  scores: ScoreItem[]
}

export interface ScorecardInputs {
  properties: { current_value?: number | null; purchase_price?: number | null; property_type: string; town: string }[]
  mortgages: { current_balance: number; monthly_payment: number; interest_rate: number; type: string; fixed_period_end?: string | null; is_active: number }[]
  tenants: { status: string; rent_amount: number; tenancy_end?: string | null }[]
  expenses: { amount: number; frequency: string; active: number }[]
  certificates: { expiry_date: string }[]
  openMaintenance: number
  rentPayments: { status: string }[]   // recent window (e.g. last 12 months)
  opportunities: {
    stage: string; asking_price?: number | null; estimated_value?: number | null
    expected_rent?: number | null; repair_costs?: number | null
    deposit_percent?: number | null; mortgage_rate?: number | null
  }[]
  today?: string
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n))
const clamp01 = (n: number) => Math.max(0, Math.min(1, n))
const ratingOf = (v: number): Rating => (v >= 75 ? 'strong' : v >= 50 ? 'fair' : 'weak')
const daysBetween = (from: Date, to: Date) => (to.getTime() - from.getTime()) / 86_400_000

function hhi(shares: number[]): number {
  return shares.reduce((s, x) => s + x * x, 0)
}

export function computeScorecard(inp: ScorecardInputs): Scorecard {
  const now = inp.today ? new Date(inp.today) : new Date()
  const kpis = calculatePortfolioKPIs(inp.properties, inp.mortgages, inp.tenants, inp.expenses)
  const props = inp.properties.length
  const active = inp.mortgages.filter(m => m.is_active === 1)
  const mortgagePayments = active.reduce((s, m) => s + m.monthly_payment, 0)
  const totalBalance = active.reduce((s, m) => s + m.current_balance, 0)
  const grossIncome = kpis.monthly_gross_income

  // ── Health: compliance + arrears + maintenance ──────────────────────────────
  let expired = 0, dueSoon = 0
  for (const c of inp.certificates) {
    const exp = new Date(c.expiry_date)
    const d = daysBetween(now, exp)
    if (d < 0) expired++
    else if (d <= 60) dueSoon++
  }
  const badRent = inp.rentPayments.filter(p => p.status === 'late' || p.status === 'missed' || p.status === 'partial').length
  const lateOrMissedPct = inp.rentPayments.length > 0 ? (badRent / inp.rentPayments.length) * 100 : 0
  const health = clamp(
    100
    - Math.min(45, expired * 15)
    - Math.min(15, dueSoon * 5)
    - Math.min(20, inp.openMaintenance * 5)
    - Math.min(20, lateOrMissedPct * 0.5)
  )

  // ── Liquidity: debt-service comfort + cashflow margin ───────────────────────
  const dscr = mortgagePayments > 0 ? grossIncome / mortgagePayments : Infinity
  const dscrScore = mortgagePayments > 0 ? clamp01((dscr - 1) / (2 - 1)) * 100 : 100
  const netMargin = grossIncome > 0 ? kpis.monthly_net_cashflow / grossIncome : 0
  const marginScore = clamp01(netMargin / 0.3) * 100
  const liquidity = clamp(0.6 * dscrScore + 0.4 * marginScore)

  // ── Rate-resilience: fixed protection + stressed DSCR + LTV headroom ────────
  const protectedBalance = active.reduce((s, m) => {
    const fixedLong = m.type === 'fixed' && m.fixed_period_end && daysBetween(now, new Date(m.fixed_period_end)) > 365
    return s + (fixedLong ? m.current_balance : 0)
  }, 0)
  const protectedPct = totalBalance > 0 ? (protectedBalance / totalBalance) * 100 : 100
  const exposedBalance = totalBalance - protectedBalance
  const stressedPayments = mortgagePayments + (exposedBalance * 0.02) / 12   // +200bps on exposed
  const stressedDscr = stressedPayments > 0 ? grossIncome / stressedPayments : Infinity
  const stressScore = stressedPayments > 0 ? clamp01((stressedDscr - 1) / (1.5 - 1)) * 100 : 100
  const ltvScore = clamp01((85 - kpis.ltv_ratio) / (85 - 40)) * 100
  const rateResilience = totalBalance > 0
    ? clamp(0.5 * protectedPct + 0.3 * stressScore + 0.2 * ltvScore)
    : 100

  // ── Vacancy: occupancy minus notice/lease-end exposure ──────────────────────
  const activeTenants = inp.tenants.filter(t => t.status === 'active')
  const noticeGiven = inp.tenants.filter(t => t.status === 'notice_given').length
  const occupancy = props > 0 ? (activeTenants.length / props) * 100 : 0
  const leasesEndingSoon = activeTenants.filter(t => {
    if (!t.tenancy_end) return false
    const d = daysBetween(now, new Date(t.tenancy_end))
    return d >= 0 && d <= 90
  }).length
  const vacancy = props > 0
    ? clamp(occupancy - (noticeGiven / props) * 25 - (leasesEndingSoon / props) * 10)
    : 0

  // ── Diversification: HHI across value / type / location ─────────────────────
  const totalValue = kpis.total_portfolio_value
  let diversification = 0
  if (props > 0 && totalValue > 0) {
    const valueShares = inp.properties.map(p => (p.current_value ?? p.purchase_price ?? 0) / totalValue)
    const countShares = (key: (p: ScorecardInputs['properties'][number]) => string) => {
      const counts = new Map<string, number>()
      for (const p of inp.properties) counts.set(key(p), (counts.get(key(p)) ?? 0) + 1)
      return [...counts.values()].map(c => c / props)
    }
    const valueScore = 100 * (1 - hhi(valueShares))
    const typeScore = 100 * (1 - hhi(countShares(p => p.property_type)))
    const geoScore = 100 * (1 - hhi(countShares(p => p.town)))
    diversification = clamp((valueScore + typeScore + geoScore) / 3)
  }

  // ── Opportunity: refinance headroom + acquisition pipeline ──────────────────
  const headroom = Math.max(0, 0.75 * totalValue - kpis.total_debt)
  const avgPropertyValue = props > 0 ? totalValue / props : 0
  const oneDeposit = 0.25 * avgPropertyValue
  const headroomScore = oneDeposit > 0 ? clamp01(headroom / oneDeposit) * 100 : 0
  const qualifiedDeals = inp.opportunities.filter(o => {
    if (['spotted', 'rejected', 'completed'].includes(o.stage)) return false
    return calculateAcquisitionMetrics(o).roi > 0
  }).length
  const pipelineScore = clamp01(qualifiedDeals / 2) * 100
  const opportunity = clamp(0.6 * headroomScore + 0.4 * pipelineScore)

  const mk = (key: string, label: string, value: number, detail: string): ScoreItem =>
    ({ key, label, value: Math.round(value), rating: ratingOf(value), detail })

  const scores: ScoreItem[] = [
    mk('health', 'Health', health,
      `${expired} expired / ${dueSoon} due-soon certs, ${inp.openMaintenance} open jobs, ${Math.round(lateOrMissedPct)}% rent late/missed.`),
    mk('liquidity', 'Liquidity', liquidity,
      `DSCR ${isFinite(dscr) ? dscr.toFixed(2) : '∞'}× (rent ÷ debt service); net margin ${Math.round(netMargin * 100)}% of rent.`),
    mk('rate_resilience', 'Rate-resilience', rateResilience,
      `${Math.round(protectedPct)}% of debt on fixed >12mo; DSCR ${stressedDscr === Infinity ? '∞' : stressedDscr.toFixed(2)}× after +2% on exposed debt; LTV ${Math.round(kpis.ltv_ratio)}%.`),
    mk('vacancy', 'Vacancy', vacancy,
      `${Math.round(occupancy)}% occupied, ${noticeGiven} on notice, ${leasesEndingSoon} lease(s) ending ≤90d.`),
    mk('diversification', 'Diversification', diversification,
      `Spread across ${new Set(inp.properties.map(p => p.property_type)).size} type(s) and ${new Set(inp.properties.map(p => p.town)).size} location(s) (HHI of value/type/area).`),
    mk('opportunity', 'Opportunity', opportunity,
      `${headroom > 0 ? '£' + Math.round(headroom).toLocaleString() : '£0'} equity to 75% LTV (~${oneDeposit > 0 ? (headroom / oneDeposit).toFixed(1) : '0'} deposits); ${qualifiedDeals} qualified pipeline deal(s).`),
  ]

  const W: Record<string, number> = { health: 0.2, liquidity: 0.2, rate_resilience: 0.2, vacancy: 0.15, diversification: 0.15, opportunity: 0.1 }
  const overallValue = scores.reduce((s, x) => s + x.value * W[x.key], 0)
  const overall = mk('overall', 'Portfolio Score', overallValue,
    'Weighted blend: Health/Liquidity/Rate-resilience 20% each, Vacancy/Diversification 15%, Opportunity 10%.')

  return { overall, scores }
}
