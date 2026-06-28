import { buildProjection, type PropertyState, type ScenarioEvent } from './scenarioEngine.ts'
import { calcTransactionCosts } from './calculations.ts'
import { type TaxSettings } from './tax.ts'

type GoalType = 'income' | 'count' | 'net_worth' | 'mortgage_free' | 'retirement_date'

interface Goal {
  goal_type: GoalType
  target_monthly_income?: number | null
  target_property_count?: number | null
  target_equity?: number | null
  target_date?: string | null
  max_ltv_pct?: number | null
  min_dscr?: number | null
  min_annual_cashflow?: number | null
  director_loan_annual?: number | null
  director_loan_start_date?: string | null
}

export interface PropertyAssumptions {
  purchase_price: number
  monthly_rent: number
  monthly_expenses?: number
  deposit_percent?: number
  mortgage_rate?: number
  mortgage_term_years?: number
}

type MonthSnapshot = {
  date: string
  total_value: number
  total_debt: number
  total_equity: number
  monthly_cashflow: number
  cumulative_cashflow: number
  monthly_cashflow_posttax: number
  cumulative_cashflow_posttax: number
  monthly_tax: number
  property_count: number
  monthly_dscr: number
}

type PropMonth = {
  date: string
  value: number
  debt: number
  equity: number
  monthly_cashflow: number
  cumulative_cashflow: number
}

type PropSeries = {
  property_id: number
  label: string
  months: PropMonth[]
}

type ProjectionResult = {
  months: MonthSnapshot[]
  property_series: PropSeries[]
  summary: {
    start_equity: number
    end_equity: number
    equity_growth: number
    equity_growth_pct: number
    total_cashflow: number
    avg_monthly_cashflow: number
    ending_monthly_cashflow: number
    total_cashflow_posttax: number
    avg_monthly_cashflow_posttax: number
    ending_monthly_cashflow_posttax: number
    total_tax_paid: number
    min_dscr: number
    months_below_dscr: number
    min_cumulative_cashflow: number
    min_cumulative_cashflow_posttax: number
  }
}

export interface GeneratedPathway {
  template_name: string
  label: string
  events: ScenarioEvent[]
  results: ProjectionResult
  feasible: boolean
  reaches_goal: boolean
  months_to_goal: number | null
  risk_score: number
  binding_constraint: string
  binding_detail: string
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function addMonths(baseDate: string, months: number): string {
  const d = new Date(baseDate)
  d.setMonth(d.getMonth() + months)
  return d.toISOString().slice(0, 10)
}

function monthDiff(baseDate: string, targetDate: string): number {
  const b = new Date(baseDate)
  const t = new Date(targetDate)
  return (t.getFullYear() - b.getFullYear()) * 12 + (t.getMonth() - b.getMonth())
}

// ─── Event builder ────────────────────────────────────────────────────────────

function buyEvent(date: string, a: PropertyAssumptions): ScenarioEvent {
  return {
    event_type: 'buy_property',
    property_id: null,
    date,
    parameters_json: JSON.stringify({
      purchase_price:     a.purchase_price,
      monthly_rent:       a.monthly_rent,
      monthly_expenses:   a.monthly_expenses ?? 200,
      deposit_percent:    a.deposit_percent ?? 25,
      mortgage_rate:      a.mortgage_rate ?? 5.5,
      mortgage_term_years: a.mortgage_term_years ?? 25,
    }),
  }
}

function payoffEvent(date: string): ScenarioEvent {
  return {
    event_type: 'payoff_mortgage',
    property_id: null,
    date,
    parameters_json: JSON.stringify({}),
  }
}

// ─── Cash-gated event generation ──────────────────────────────────────────────
// Decisions (buy / payoff) are driven by the accumulated cash pot — read straight
// from the engine's true-cash `cumulative_cashflow` line — not by fixed timers.
// Greedy forward insertion: re-project after every decision so each subsequent
// choice sees the updated cash balance (deposits/payoffs drawn, loans added).

type Strategy = 'steady' | 'accelerated' | 'recycler'

function depositPlusCosts(a: PropertyAssumptions): number {
  const price = a.purchase_price
  const deposit = price * ((a.deposit_percent ?? 25) / 100)
  const { total: txCosts } = calcTransactionCosts(price, 2000, 0)
  return deposit + txCosts
}

function cloneState(initial: Map<number, PropertyState>): Map<number, PropertyState> {
  return new Map(Array.from(initial.entries()).map(([k, v]) => [k, { ...v }]))
}

// Active mortgages / smallest balance at absolute month i, read from property_series
function activeBalancesAt(proj: ProjectionResult, i: number): number[] {
  const ym = proj.months[i].date
  const out: number[] = []
  for (const ps of proj.property_series) {
    const pm = ps.months.find(m => m.date === ym)
    if (pm && pm.debt > 0) out.push(pm.debt)
  }
  return out
}

function buildCashGatedEvents(
  strategy: Strategy,
  baseDate: string,
  projYears: number,
  a: PropertyAssumptions,
  initialState: Map<number, PropertyState>,
  loanEvents: ScenarioEvent[],
  tax?: TaxSettings
): ScenarioEvent[] {
  const totalMonths = projYears * 12
  const config = { base_date: baseDate, projection_years: projYears, tax }
  const buyCost = depositPlusCosts(a)
  const monthlyExp = a.monthly_expenses ?? 200
  const buffer = strategy === 'steady' ? monthlyExp * 6 : 0  // steady keeps a reserve
  const cap = projYears * 4                                   // hard ceiling on decisions

  const decisions: ScenarioEvent[] = []
  let lastMonth = 0

  while (decisions.length < cap) {
    const events = [...loanEvents, ...decisions].sort((x, y) => x.date.localeCompare(y.date))
    const proj = buildProjection(cloneState(initialState), events, config) as ProjectionResult

    let decided: ScenarioEvent | null = null
    let decidedMonth = -1

    for (let i = lastMonth; i < proj.months.length && i < totalMonths; i++) {
      // Gate on post-tax cash — taxes genuinely reduce deposit capital.
      const cash = proj.months[i].cumulative_cashflow_posttax ?? proj.months[i].cumulative_cashflow

      if (strategy === 'recycler') {
        const balances = activeBalancesAt(proj, i)
        if (balances.length < 2) {
          if (cash >= buyCost) { decided = buyEvent(proj.months[i].date, a); decidedMonth = i; break }
        } else {
          const smallest = Math.min(...balances)
          if (cash >= smallest) { decided = payoffEvent(proj.months[i].date); decidedMonth = i; break }
        }
      } else {
        if (cash >= buyCost + buffer) { decided = buyEvent(proj.months[i].date, a); decidedMonth = i; break }
      }
    }

    if (!decided || decidedMonth < lastMonth) break
    decisions.push(decided)
    lastMonth = decidedMonth + 1   // guarantee forward progress
  }

  return decisions
}

// ─── Director loan events ─────────────────────────────────────────────────────

function buildDirectorLoanEvents(
  baseDate: string,
  projYears: number,
  annualAmount: number,
  startDate?: string | null
): ScenarioEvent[] {
  const events: ScenarioEvent[] = []
  const totalMonths = projYears * 12
  let offsetMonths = startDate ? monthDiff(baseDate, startDate) : 0
  if (offsetMonths < 0) offsetMonths = 0
  for (let mo = offsetMonths; mo < totalMonths; mo += 12) {
    events.push({
      event_type: 'director_loan_in',
      property_id: null,
      date: addMonths(baseDate, mo),
      parameters_json: JSON.stringify({ amount: annualAmount }),
    })
  }
  return events
}

// ─── Constraint checker ───────────────────────────────────────────────────────

function checkConstraints(months: MonthSnapshot[], goal: Goal): boolean {
  for (const m of months) {
    if (goal.max_ltv_pct != null && m.total_value > 0) {
      const ltv = (m.total_debt / m.total_value) * 100
      if (ltv > goal.max_ltv_pct) return false
    }
    if (goal.min_dscr != null && m.monthly_dscr > 0) {
      if (m.monthly_dscr < goal.min_dscr) return false
    }
    if (goal.min_annual_cashflow != null) {
      // Post-tax: the cash actually available to the investor.
      const postTaxMonthly = m.monthly_cashflow_posttax ?? m.monthly_cashflow
      if (postTaxMonthly * 12 < goal.min_annual_cashflow) return false
    }
  }
  return true
}

// ─── Goal-reached checker ─────────────────────────────────────────────────────

function checkGoalReached(months: MonthSnapshot[], goal: Goal): { reached: boolean; monthIndex: number | null } {
  for (let i = 0; i < months.length; i++) {
    const m = months[i]
    // Income/retirement goals judged on post-tax cash — the real FI number.
    const postTaxMonthly = m.monthly_cashflow_posttax ?? m.monthly_cashflow
    let hit = false
    switch (goal.goal_type) {
      case 'income':
        hit = goal.target_monthly_income != null && postTaxMonthly >= goal.target_monthly_income
        break
      case 'count':
        hit = goal.target_property_count != null && m.property_count >= goal.target_property_count
        break
      case 'net_worth':
        hit = goal.target_equity != null && m.total_equity >= goal.target_equity
        break
      case 'mortgage_free':
        hit = m.total_debt === 0 &&
          (goal.target_date == null || m.date.slice(0, 7) <= goal.target_date.slice(0, 7))
        break
      case 'retirement_date':
        hit = postTaxMonthly >= 0 &&
          (goal.target_date == null || m.date.slice(0, 7) <= goal.target_date.slice(0, 7))
        break
    }
    if (hit) return { reached: true, monthIndex: i }
  }
  return { reached: false, monthIndex: null }
}

// ─── Ranking: risk score + binding constraint (C3) ────────────────────────────

type Summary = ProjectionResult['summary']

// Lower = safer. Transparent, documented in the plan.
export function computeRiskScore(summary: Summary): number {
  return summary.months_below_dscr * 2
    + (summary.min_cumulative_cashflow < 0 ? 100 : 0)
    + (summary.min_dscr > 0 ? Math.max(0, 1.5 - summary.min_dscr) * 20 : 0)
}

type Binding = { key: string; detail: string }

// Identify the limiting factor: the tightest (or violated) constraint, else
// deposit capital / horizon for a cash-gated pathway with constraint slack.
export function analyzeBinding(
  goal: Goal,
  months: MonthSnapshot[],
  summary: Summary,
  reachesGoal: boolean,
  buyCost: number
): Binding {
  let maxLtv = 0
  let minAnnualCF = Infinity
  for (const m of months) {
    if (m.total_value > 0) maxLtv = Math.max(maxLtv, (m.total_debt / m.total_value) * 100)
    minAnnualCF = Math.min(minAnnualCF, m.monthly_cashflow * 12)
  }
  if (!isFinite(minAnnualCF)) minAnnualCF = 0

  type C = { key: string; headroom: number; label: string }
  const cons: C[] = []
  if (goal.max_ltv_pct != null) {
    cons.push({ key: 'ltv', headroom: (goal.max_ltv_pct - maxLtv) / goal.max_ltv_pct,
      label: `LTV peaked at ${maxLtv.toFixed(0)}% vs ${goal.max_ltv_pct}% ceiling` })
  }
  if (goal.min_dscr != null && summary.min_dscr > 0) {
    cons.push({ key: 'dscr', headroom: (summary.min_dscr - goal.min_dscr) / goal.min_dscr,
      label: `DSCR fell to ${summary.min_dscr.toFixed(2)}× vs ${goal.min_dscr.toFixed(2)}× floor` })
  }
  if (goal.min_annual_cashflow != null) {
    cons.push({ key: 'cashflow', headroom: (minAnnualCF - goal.min_annual_cashflow) / Math.max(Math.abs(goal.min_annual_cashflow), 1),
      label: `annual cashflow dipped to £${Math.round(minAnnualCF).toLocaleString()} vs £${goal.min_annual_cashflow.toLocaleString()} floor` })
  }
  // Liquidity is always meaningful under the true-cash model
  cons.push({ key: 'liquidity', headroom: summary.min_cumulative_cashflow / Math.max(buyCost, 1),
    label: `cash dipped to £${Math.round(summary.min_cumulative_cashflow).toLocaleString()}` })

  const violated = cons.filter(c => c.headroom < 0).sort((a, b) => a.headroom - b.headroom)
  if (violated.length > 0) {
    const v = violated[0]
    return { key: v.key, detail: `Infeasible — ${v.label}.` }
  }

  const tightest = cons.slice().sort((a, b) => a.headroom - b.headroom)[0]
  const SLACK = 0.25 // >25% headroom ⇒ not really binding

  if (reachesGoal) {
    if (tightest && tightest.headroom <= SLACK) {
      return { key: tightest.key, detail: `Reaches goal; tightest constraint is ${tightest.label}.` }
    }
    return { key: 'capital', detail: 'Reaches goal; pace set by available deposit capital.' }
  }

  // Feasible but goal not reached within the horizon
  if (tightest && tightest.headroom <= SLACK) {
    return { key: tightest.key, detail: `Limited by ${tightest.label} — relax it to progress.` }
  }
  return { key: 'capital', detail: 'Limited by deposit capital / time — add director loans or extend the horizon.' }
}

// Rank a set by time-to-goal + risk; flag the top feasible as recommended (C3).
export interface RankablePathway {
  id: number
  feasible: number            // SQLite 0/1
  reaches_goal: number        // SQLite 0/1
  months_to_goal?: number | null
  risk_score?: number | null
  summary?: { end_equity?: number } | null
}

export function rankPathways<T extends RankablePathway>(rows: T[]): (T & { rank: number; recommended: boolean })[] {
  const sorted = [...rows].sort((a, b) => {
    const ar = a.reaches_goal ? 0 : 1, br = b.reaches_goal ? 0 : 1
    if (ar !== br) return ar - br
    const am = a.months_to_goal ?? Infinity, bm = b.months_to_goal ?? Infinity
    if (am !== bm) return am - bm
    const arisk = a.risk_score ?? Infinity, brisk = b.risk_score ?? Infinity
    if (arisk !== brisk) return arisk - brisk
    return (b.summary?.end_equity ?? 0) - (a.summary?.end_equity ?? 0)
  })
  const recId = sorted.find(p => p.feasible === 1)?.id ?? null
  return sorted.map((p, i) => ({ ...p, rank: i + 1, recommended: p.id === recId }))
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function generatePathways(
  goal: Goal,
  initialState: Map<number, PropertyState>,
  assumptions: PropertyAssumptions,
  projectionYears: number,
  _activeMortgageCount: number,  // retained for API stability; recycler now reads live debt
  tax?: TaxSettings              // global tax settings → post-tax goal solving
): GeneratedPathway[] {
  const baseDate = new Date().toISOString().slice(0, 10)

  const config = {
    base_date: baseDate,
    projection_years: projectionYears,
    tax,
  }

  const loanEvents = goal.director_loan_annual
    ? buildDirectorLoanEvents(baseDate, projectionYears, goal.director_loan_annual, goal.director_loan_start_date)
    : []

  const templates: Array<{ template_name: string; label: string; strategy: Strategy }> = [
    { template_name: 'steady_growth',      label: 'Steady Growth',      strategy: 'steady' },
    { template_name: 'accelerated_growth', label: 'Accelerated Growth', strategy: 'accelerated' },
    { template_name: 'mortgage_recycler',  label: 'Mortgage Recycler',  strategy: 'recycler' },
  ]

  return templates.map(t => {
    // Cash-gated decisions (buys/payoffs), then merge loan events for the final run
    const decisions = buildCashGatedEvents(t.strategy, baseDate, projectionYears, assumptions, initialState, loanEvents, tax)
    const allEvents = [...decisions, ...loanEvents].sort((a, b) => a.date.localeCompare(b.date))

    const results = buildProjection(cloneState(initialState), allEvents, config) as ProjectionResult
    const feasible = checkConstraints(results.months, goal) && results.summary.min_cumulative_cashflow >= 0
    const { reached, monthIndex } = checkGoalReached(results.months, goal)

    const risk_score = computeRiskScore(results.summary)
    const { key: binding_constraint, detail: binding_detail } =
      analyzeBinding(goal, results.months, results.summary, reached, depositPlusCosts(assumptions))

    return {
      template_name: t.template_name,
      label: t.label,
      events: allEvents,
      results,
      feasible,
      reaches_goal: reached,
      months_to_goal: monthIndex,
      risk_score,
      binding_constraint,
      binding_detail,
    }
  })
}

export { monthDiff }
