// Risk heatmap (Epic D2). Each factor is positioned on a 5×5 likelihood × impact
// matrix from transparent threshold maps over the same portfolio facts the
// scorecard uses. Pure + unit-tested.

import { calculatePortfolioKPIs } from './calculations.ts'
import type { ScorecardInputs } from './scorecard.ts'

export type RiskBand = 'low' | 'medium' | 'high' | 'critical'

export interface RiskFactor {
  key: string
  label: string
  likelihood: number   // 1–5
  impact: number       // 1–5
  severity: number     // likelihood × impact (1–25)
  band: RiskBand
  rationale: string
  mitigation: string
}

export interface RiskHeatmap {
  factors: RiskFactor[]
}

const daysBetween = (from: Date, to: Date) => (to.getTime() - from.getTime()) / 86_400_000
const gbp = (n: number) => '£' + Math.round(n).toLocaleString()

// Ascending thresholds [t1,t2,t3,t4] → 1..5
function scale5(x: number, t: [number, number, number, number]): number {
  if (x < t[0]) return 1
  if (x < t[1]) return 2
  if (x < t[2]) return 3
  if (x < t[3]) return 4
  return 5
}

function bandOf(sev: number): RiskBand {
  return sev <= 4 ? 'low' : sev <= 9 ? 'medium' : sev <= 14 ? 'high' : 'critical'
}

function hhi(shares: number[]): number {
  return shares.reduce((s, x) => s + x * x, 0)
}

export function computeRiskHeatmap(inp: ScorecardInputs): RiskHeatmap {
  const now = inp.today ? new Date(inp.today) : new Date()
  const kpis = calculatePortfolioKPIs(inp.properties, inp.mortgages, inp.tenants, inp.expenses)
  const props = inp.properties.length

  const active = inp.mortgages.filter(m => m.is_active === 1)
  const mortgagePayments = active.reduce((s, m) => s + m.monthly_payment, 0)
  const totalBalance = active.reduce((s, m) => s + m.current_balance, 0)
  const grossIncome = kpis.monthly_gross_income
  const dscr = mortgagePayments > 0 ? grossIncome / mortgagePayments : Infinity
  const netMargin = grossIncome > 0 ? kpis.monthly_net_cashflow / grossIncome : 0

  const isProtected = (m: typeof active[number]) =>
    m.type === 'fixed' && !!m.fixed_period_end && daysBetween(now, new Date(m.fixed_period_end!)) > 365
  const protectedBalance = active.reduce((s, m) => s + (isProtected(m) ? m.current_balance : 0), 0)
  const exposedBalance = totalBalance - protectedBalance
  const exposedPct = totalBalance > 0 ? (exposedBalance / totalBalance) * 100 : 0
  const nearExpiry = active.filter(m => m.fixed_period_end && daysBetween(now, new Date(m.fixed_period_end!)) <= 365).length
  const stressedPayments = mortgagePayments + (exposedBalance * 0.02) / 12
  const stressedDscr = stressedPayments > 0 ? grossIncome / stressedPayments : Infinity

  const activeTenants = inp.tenants.filter(t => t.status === 'active')
  const occupancy = props > 0 ? (activeTenants.length / props) * 100 : 0
  const noticeGiven = inp.tenants.filter(t => t.status === 'notice_given').length
  const vacantNow = Math.max(0, props - activeTenants.length)
  const leasesEndingSoon = activeTenants.filter(t => {
    if (!t.tenancy_end) return false
    const d = daysBetween(now, new Date(t.tenancy_end))
    return d >= 0 && d <= 90
  }).length

  const badRent = inp.rentPayments.filter(p => ['late', 'missed', 'partial'].includes(p.status)).length
  const arrearsPct = inp.rentPayments.length > 0 ? (badRent / inp.rentPayments.length) * 100 : 0

  let expired = 0, dueSoon = 0
  for (const c of inp.certificates) {
    const d = daysBetween(now, new Date(c.expiry_date))
    if (d < 0) expired++
    else if (d <= 60) dueSoon++
  }

  // Concentration: HHI over town/type counts + dominant town value share
  const totalValue = kpis.total_portfolio_value
  const countShares = (key: (p: ScorecardInputs['properties'][number]) => string) => {
    const counts = new Map<string, number>()
    for (const p of inp.properties) counts.set(key(p), (counts.get(key(p)) ?? 0) + 1)
    return props > 0 ? [...counts.values()].map(c => c / props) : []
  }
  const geoHhi = props > 0 ? hhi(countShares(p => p.town)) : 0
  const typeHhi = props > 0 ? hhi(countShares(p => p.property_type)) : 0
  const concHhi = (geoHhi + typeHhi) / 2
  const townValue = new Map<string, number>()
  for (const p of inp.properties) {
    const v = p.current_value ?? p.purchase_price ?? 0
    townValue.set(p.town, (townValue.get(p.town) ?? 0) + v)
  }
  const domTown = [...townValue.entries()].sort((a, b) => b[1] - a[1])[0]
  const domShare = totalValue > 0 && domTown ? domTown[1] / totalValue : 0

  const factors: RiskFactor[] = []
  const add = (key: string, label: string, likelihood: number, impact: number, rationale: string, mitigation: string) => {
    const L = Math.max(1, Math.min(5, likelihood))
    const I = Math.max(1, Math.min(5, impact))
    const severity = L * I
    factors.push({ key, label, likelihood: L, impact: I, severity, band: bandOf(severity), rationale, mitigation })
  }

  // 1. Interest-rate repricing
  if (totalBalance === 0) {
    add('interest_rate', 'Interest-rate repricing', 1, 1, 'No active mortgage debt.', 'No action — portfolio is unleveraged.')
  } else {
    const L = scale5(exposedPct, [10, 30, 50, 75])
    const I = stressedDscr < 1 ? 5 : stressedDscr < 1.25 ? 4 : stressedDscr < 1.5 ? 3 : stressedDscr < 2 ? 2 : 1
    add('interest_rate', 'Interest-rate repricing', L, I,
      `${Math.round(exposedPct)}% of debt (${gbp(exposedBalance)}) is variable or reprices ≤12mo; ${nearExpiry} deal(s) within a year. Stressed DSCR ${stressedDscr === Infinity ? '∞' : stressedDscr.toFixed(2)}× at +2%.`,
      nearExpiry > 0 ? `Secure new fixes before the ${nearExpiry} upcoming reprice(s); model the +2% case in What-If.` : 'Consider fixing exposed balances while rates are stable.')
  }

  // 2. Liquidity / cashflow
  {
    const dscrL = mortgagePayments === 0 ? 1 : dscr < 1 ? 5 : dscr < 1.25 ? 4 : dscr < 1.5 ? 3 : dscr < 2 ? 2 : 1
    const marginL = netMargin < 0 ? 5 : netMargin < 0.05 ? 4 : netMargin < 0.1 ? 3 : netMargin < 0.2 ? 2 : 1
    const L = Math.max(dscrL, marginL)
    const I = kpis.monthly_net_cashflow < 0 ? 5 : 4
    add('liquidity', 'Liquidity / cashflow', L, I,
      `DSCR ${dscr === Infinity ? '∞' : dscr.toFixed(2)}×; net cashflow ${gbp(kpis.monthly_net_cashflow)}/mo (${Math.round(netMargin * 100)}% margin).`,
      'Hold a cash reserve of 3–6 months of outgoings; trim variable costs or raise rents to lender review.')
  }

  // 3. Void / vacancy
  {
    const exposurePct = props > 0 ? ((vacantNow + noticeGiven * 0.7 + leasesEndingSoon * 0.4) / props) * 100 : 0
    const L = props === 0 ? 1 : scale5(exposurePct, [5, 15, 30, 50])
    const I = props <= 1 ? 5 : props <= 2 ? 4 : props <= 4 ? 3 : 2
    add('void', 'Void / vacancy', L, I,
      `${Math.round(occupancy)}% occupied; ${vacantNow} vacant, ${noticeGiven} on notice, ${leasesEndingSoon} lease(s) ending ≤90d across ${props} propert${props === 1 ? 'y' : 'ies'}.`,
      'Re-let or renew ahead of expiry; stagger tenancy end-dates to avoid clustered voids.')
  }

  // 4. Tenant arrears
  {
    const L = inp.rentPayments.length === 0 ? 1 : scale5(arrearsPct, [2, 5, 15, 30])
    const I = arrearsPct > 15 ? 3 : 2
    add('arrears', 'Tenant arrears', L, I,
      `${Math.round(arrearsPct)}% of rent payments in the last 12 months were late, partial or missed.`,
      'Tighten referencing; consider rent guarantee insurance; act early on arrears.')
  }

  // 5. Concentration
  {
    const L = props <= 1 ? 5 : scale5(concHhi, [0.3, 0.45, 0.6, 0.8])
    const I = scale5(domShare, [0.3, 0.5, 0.7, 0.85])
    add('concentration', 'Concentration', L, I,
      `${domTown ? Math.round(domShare * 100) + '% of value in ' + domTown[0] : 'Single holding'}; spread across ${new Set(inp.properties.map(p => p.town)).size} location(s) and ${new Set(inp.properties.map(p => p.property_type)).size} type(s).`,
      'Diversify the next acquisition by area and property type to dilute a local shock.')
  }

  // 6. Compliance
  {
    const L = expired >= 2 ? 5 : expired === 1 ? 4 : dueSoon >= 2 ? 3 : dueSoon === 1 ? 2 : 1
    const I = expired > 0 ? 5 : 4
    add('compliance', 'Compliance', L, I,
      `${expired} expired and ${dueSoon} due-soon certificate(s).`,
      expired + dueSoon > 0 ? `Renew the ${expired + dueSoon} outstanding certificate(s) — expired safety certs block possession and risk fines.` : 'All certificates current — keep the renewal calendar up to date.')
  }

  // 7. Leverage / value fall
  {
    const ltv = kpis.ltv_ratio
    const L = totalBalance === 0 ? 1 : scale5(ltv, [50, 65, 75, 85])
    const erosionPct = kpis.total_equity > 0 ? (0.10 * totalValue) / kpis.total_equity * 100 : (kpis.total_debt > 0 ? 100 : 0)
    const I = scale5(erosionPct, [15, 25, 40, 60])
    add('leverage', 'Leverage / value fall', L, I,
      `Portfolio LTV ${Math.round(ltv)}%; a 10% value fall erodes ~${Math.round(erosionPct)}% of equity.`,
      'Keep LTV below your lender stress threshold; direct surplus cash to paying down the highest-LTV asset.')
  }

  return { factors }
}
