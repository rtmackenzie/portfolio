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
  min_cash_reserve_months?: number | null
  capex_reserve_per_property?: number | null
  starting_cash?: number | null   // real cash on hand today; defaults to the starting
                                   // portfolio's own reserve requirement when unset (§P0-3)
  mortgage_reprice_years?: number | null       // fixed-rate term before reverting; default 5 (§P1-5)
  mortgage_reprice_uplift_bps?: number | null  // rate rise at each reprice; default 200 (§P1-5)
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
  assumptions_json: string
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

function buyEvent(date: string, a: PropertyAssumptions, interestOnly = false): ScenarioEvent {
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
      interest_only:      interestOnly,
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

// Reach 105% of a numeric target so the plan stops with a small buffer, not on a
// knife-edge. Count / date targets are left exact.
const GOAL_MARGIN = 1.05
function withMargin(goal: Goal): Goal {
  return {
    ...goal,
    target_monthly_income: goal.target_monthly_income != null ? goal.target_monthly_income * GOAL_MARGIN : goal.target_monthly_income,
    target_equity:         goal.target_equity != null ? goal.target_equity * GOAL_MARGIN : goal.target_equity,
  }
}

// Minimum cash the portfolio must retain at a given size — scales with outgoings and a
// per-property capex float (P0 #3 fix). Configurable per goal; shared by generation,
// constraint-checking and binding-constraint analysis so all three stay in lockstep.
function reserveFloor(goal: Goal, monthlyExp: number, propertyCount: number): number {
  const months = goal.min_cash_reserve_months ?? 3
  const capex = goal.capex_reserve_per_property ?? 1000
  return months * monthlyExp * Math.max(1, propertyCount) + capex * propertyCount
}

function buildCashGatedEvents(
  strategy: Strategy,
  baseDate: string,
  projYears: number,
  a: PropertyAssumptions,
  initialState: Map<number, PropertyState>,
  loanEvents: ScenarioEvent[],
  tax: TaxSettings | undefined,
  goal: Goal,
  stopAtGoal: boolean,
  interestOnly: boolean,
  startingCash: number,
  assumptionsJson: string
): ScenarioEvent[] {
  const totalMonths = projYears * 12
  const config = { base_date: baseDate, projection_years: projYears, tax, starting_cash: startingCash, assumptions_json: assumptionsJson }
  const buyCost = depositPlusCosts(a)
  const monthlyExp = a.monthly_expenses ?? 200
  const cap = projYears * 4                                   // hard ceiling on decisions
  const marginGoal = withMargin(goal)

  const decisions: ScenarioEvent[] = []
  let lastMonth = 0

  while (decisions.length < cap) {
    const events = [...loanEvents, ...decisions].sort((x, y) => x.date.localeCompare(y.date))
    const proj = buildProjection(cloneState(initialState), events, config) as ProjectionResult

    // Stop acquiring once the goal is met (+margin); the projection still runs to the horizon.
    let goalCap = totalMonths
    if (stopAtGoal) {
      const reach = checkGoalReached(proj.months, marginGoal)
      if (reach.reached && reach.monthIndex != null) goalCap = reach.monthIndex
    }

    let decided: ScenarioEvent | null = null
    let decidedMonth = -1

    for (let i = lastMonth; i < proj.months.length && i < totalMonths && i < goalCap; i++) {
      // Gate on post-tax cash — taxes genuinely reduce deposit capital.
      const cash = proj.months[i].cumulative_cashflow_posttax ?? proj.months[i].cumulative_cashflow

      const propCount = proj.months[i].property_count

      if (strategy === 'recycler') {
        const balances = activeBalancesAt(proj, i)
        if (balances.length < 2) {
          if (cash - buyCost >= reserveFloor(goal, monthlyExp, propCount + 1)) { decided = buyEvent(proj.months[i].date, a, interestOnly); decidedMonth = i; break }
        } else {
          const smallest = Math.min(...balances)
          if (cash - smallest >= reserveFloor(goal, monthlyExp, propCount)) { decided = payoffEvent(proj.months[i].date); decidedMonth = i; break }
        }
      } else {
        if (cash - buyCost >= reserveFloor(goal, monthlyExp, propCount + 1)) { decided = buyEvent(proj.months[i].date, a, interestOnly); decidedMonth = i; break }
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

function checkConstraints(months: MonthSnapshot[], goal: Goal, monthlyExp: number = 200): boolean {
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
    // Cash reserve (P0 #3): a real emergency/capex float, not just "stays above £0".
    const cashAvail = m.cumulative_cashflow_posttax ?? m.cumulative_cashflow
    if (cashAvail < reserveFloor(goal, monthlyExp, m.property_count)) return false
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
  buyCost: number,
  monthlyExp: number = 200
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
  // Cash reserve (P0 #3): headroom vs a real, portfolio-size-scaled reserve floor —
  // not just "stays above £0". Always meaningful under the true-cash model.
  let minReserveHeadroom = Infinity
  let reserveLabel = ''
  for (const m of months) {
    const cashAvail = m.cumulative_cashflow_posttax ?? m.cumulative_cashflow
    const floor = reserveFloor(goal, monthlyExp, m.property_count)
    const headroom = floor > 0 ? (cashAvail - floor) / floor : 0
    if (headroom < minReserveHeadroom) {
      minReserveHeadroom = headroom
      reserveLabel = `cash reserve dipped to £${Math.round(cashAvail).toLocaleString()} vs a £${Math.round(floor).toLocaleString()} (${goal.min_cash_reserve_months ?? 3}-month) floor`
    }
  }
  if (!isFinite(minReserveHeadroom)) minReserveHeadroom = 0
  cons.push({ key: 'reserve', headroom: minReserveHeadroom, label: reserveLabel })

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
  const monthlyExp = assumptions.monthly_expenses ?? 200

  // Real cash on hand today. Defaults to the starting portfolio's own reserve
  // requirement — i.e. assume an established portfolio already holds an adequate
  // reserve unless told otherwise — so existing goals aren't retroactively marked
  // infeasible purely because the projection has no day-zero bank balance (§P0-3).
  const startingCash = goal.starting_cash ?? reserveFloor(goal, monthlyExp, initialState.size)

  // Snapshot every assumption the projection actually uses onto the generated
  // scenario, so it's fully self-describing/editable afterward in What-If (§P1-5 fix).
  const assumptionsJson = JSON.stringify({
    property_growth_pct: 3.0,
    rent_growth_pct: 2.5,
    expense_inflation_pct: 2.5,
    void_months_per_year: 0.5,
    mortgage_reprice_years: goal.mortgage_reprice_years ?? 5,
    mortgage_reprice_uplift_bps: goal.mortgage_reprice_uplift_bps ?? 200,
  })

  const config = {
    base_date: baseDate,
    projection_years: projectionYears,
    tax,
    starting_cash: startingCash,
    assumptions_json: assumptionsJson,
  }

  const loanEvents = goal.director_loan_annual
    ? buildDirectorLoanEvents(baseDate, projectionYears, goal.director_loan_annual, goal.director_loan_start_date)
    : []

  // Efficient frontier: three genuinely distinct strategies.
  //  • Target & Hold  — repayment, stop at goal (fewest units, debt amortises, then holds)
  //  • Maximise Cashflow — interest-only, grow (most income / fastest, highest rate risk)
  //  • Mortgage Recycler — repayment + payoffs, grow (lowest debt, most resilient)
  const templates: Array<{ template_name: string; label: string; strategy: Strategy; stopAtGoal: boolean; interestOnly: boolean }> = [
    { template_name: 'target_hold',       label: 'Target & Hold',     strategy: 'steady',   stopAtGoal: true,  interestOnly: false },
    { template_name: 'max_cashflow',      label: 'Maximise Cashflow', strategy: 'steady',   stopAtGoal: false, interestOnly: true  },
    { template_name: 'mortgage_recycler', label: 'Mortgage Recycler', strategy: 'recycler', stopAtGoal: false, interestOnly: false },
  ]

  return templates.map(t => {
    // Cash-gated decisions (buys/payoffs), then merge loan events for the final run
    const decisions = buildCashGatedEvents(t.strategy, baseDate, projectionYears, assumptions, initialState, loanEvents, tax, goal, t.stopAtGoal, t.interestOnly, startingCash, assumptionsJson)
    const allEvents = [...decisions, ...loanEvents].sort((a, b) => a.date.localeCompare(b.date))

    const results = buildProjection(cloneState(initialState), allEvents, config) as ProjectionResult
    const feasible = checkConstraints(results.months, goal, monthlyExp) && results.summary.min_cumulative_cashflow >= 0
    const { reached, monthIndex } = checkGoalReached(results.months, goal)

    // Interim risk penalty: interest-only carries rate + no-amortisation risk the model
    // doesn't yet price (P1 #5). Penalise proportional to sustained (terminal) leverage so
    // an IO book can't rank as "safest". Replaced by real repricing once P1 #5 lands.
    const last = results.months[results.months.length - 1]
    const terminalLtv = last && last.total_value > 0 ? (last.total_debt / last.total_value) * 100 : 0
    const risk_score = computeRiskScore(results.summary) + (t.interestOnly ? Math.round(terminalLtv) : 0)

    const binding = analyzeBinding(goal, results.months, results.summary, reached, depositPlusCosts(assumptions), monthlyExp)
    const binding_constraint = binding.key
    const binding_detail = t.interestOnly
      ? `Interest-only — rate-exposed, debt not amortised. ${binding.detail}`
      : binding.detail

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
      assumptions_json: assumptionsJson,
    }
  })
}

export { monthDiff }
