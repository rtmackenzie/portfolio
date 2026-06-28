import { buildProjection, type PropertyState, type ScenarioEvent } from './scenarioEngine.ts'
import { calcTransactionCosts } from './calculations.ts'

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
    min_dscr: number
    months_below_dscr: number
    min_cumulative_cashflow: number
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
  loanEvents: ScenarioEvent[]
): ScenarioEvent[] {
  const totalMonths = projYears * 12
  const config = { base_date: baseDate, projection_years: projYears }
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
      const cash = proj.months[i].cumulative_cashflow

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
      if (m.monthly_cashflow * 12 < goal.min_annual_cashflow) return false
    }
  }
  return true
}

// ─── Goal-reached checker ─────────────────────────────────────────────────────

function checkGoalReached(months: MonthSnapshot[], goal: Goal): { reached: boolean; monthIndex: number | null } {
  for (let i = 0; i < months.length; i++) {
    const m = months[i]
    let hit = false
    switch (goal.goal_type) {
      case 'income':
        hit = goal.target_monthly_income != null && m.monthly_cashflow >= goal.target_monthly_income
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
        hit = m.monthly_cashflow >= 0 &&
          (goal.target_date == null || m.date.slice(0, 7) <= goal.target_date.slice(0, 7))
        break
    }
    if (hit) return { reached: true, monthIndex: i }
  }
  return { reached: false, monthIndex: null }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function generatePathways(
  goal: Goal,
  initialState: Map<number, PropertyState>,
  assumptions: PropertyAssumptions,
  projectionYears: number,
  _activeMortgageCount: number   // retained for API stability; recycler now reads live debt
): GeneratedPathway[] {
  const baseDate = new Date().toISOString().slice(0, 10)

  const config = {
    base_date: baseDate,
    projection_years: projectionYears,
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
    const decisions = buildCashGatedEvents(t.strategy, baseDate, projectionYears, assumptions, initialState, loanEvents)
    const allEvents = [...decisions, ...loanEvents].sort((a, b) => a.date.localeCompare(b.date))

    const results = buildProjection(cloneState(initialState), allEvents, config) as ProjectionResult
    const feasible = checkConstraints(results.months, goal) && results.summary.min_cumulative_cashflow >= 0
    const { reached, monthIndex } = checkGoalReached(results.months, goal)

    return {
      template_name: t.template_name,
      label: t.label,
      events: allEvents,
      results,
      feasible,
      reaches_goal: reached,
      months_to_goal: monthIndex,
    }
  })
}

export { monthDiff }
