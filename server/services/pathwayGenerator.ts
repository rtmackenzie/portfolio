import { buildProjection, type PropertyState, type ScenarioEvent } from './scenarioEngine.ts'
import { calcTransactionCosts, calcMonthlyPayment } from './calculations.ts'
import { icrThresholdPct, type TaxSettings } from './tax.ts'
import type { AssumptionSettings } from './assumptions.ts'
import type { IrrBasis } from './returnMetrics.ts'

type GoalType = 'income' | 'count' | 'net_worth' | 'mortgage_free' | 'retirement_date'

export interface Goal {
  goal_type: GoalType
  target_monthly_income?: number | null
  target_property_count?: number | null
  target_equity?: number | null
  target_date?: string | null
  max_ltv_pct?: number | null
  min_icr?: number | null   // lender ICR floor, %; defaults to the tax-derived 125/145 threshold (§P0-4)
  min_annual_cashflow?: number | null
  director_loan_annual?: number | null
  director_loan_start_date?: string | null
  min_cash_reserve_months?: number | null
  capex_reserve_per_property?: number | null
  starting_cash?: number | null   // real cash on hand today; defaults to the starting
                                   // portfolio's own reserve requirement when unset (§P0-3)
  mortgage_reprice_years?: number | null       // fixed-rate term before reverting; default 5 (§P1-5)
  mortgage_reprice_uplift_bps?: number | null  // rate rise at each reprice; default 200 (§P1-5)
  erc_pct?: number | null   // early-repayment-charge %, on payoffs/remortgages before a fix ends; default 3 (§P1-6)
}

export interface PropertyAssumptions {
  purchase_price: number
  monthly_rent: number
  monthly_expenses?: number
  deposit_percent?: number
  mortgage_rate?: number
  mortgage_term_years?: number
  legal_fees?: number        // legal/survey fee at purchase; default £2,000
  arrangement_fee?: number   // mortgage product fee at purchase; default £999 (§P1-6)
  valuation_fee?: number     // lender valuation/survey fee at purchase; default £300 (§P1-6)
  completion_lag_months?: number   // offer-to-completion delay; default 2 (§P1-6, 2nd review)
  onboarding_void_months?: number  // no-rent re-letting/works period post-completion; default 1 (§P1-6, 2nd review)
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
  monthly_cover_ratio: number
  monthly_icr: number
  total_rent: number
}

type PropMonth = {
  date: string
  value: number
  debt: number
  equity: number
  monthly_cashflow: number
  cumulative_cashflow: number
  is_fixed_rate: boolean
  next_reprice_month: number | null
}

type PropSeries = {
  property_id: number
  label: string
  months: PropMonth[]
}

type DebtCalendarEntry = {
  property_id: number
  label: string
  maturity_date: string | null
  next_reprice_date: string | null
}

type ProjectionResult = {
  months: MonthSnapshot[]
  property_series: PropSeries[]
  debt_calendar: DebtCalendarEntry[]
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
    min_cover_ratio: number
    months_below_cover: number
    min_icr: number
    months_below_icr: number
    min_cumulative_cashflow: number
    min_cumulative_cashflow_posttax: number
    total_capital_invested: number
    equity_multiple: number | null
    irr_pct: number | null
    irr_basis: IrrBasis | null
    roce_pct: number | null
    cash_on_cash_pct: number | null
    net_yield_on_cost_pct: number | null
    months_to_payback: number | null
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
  risk_band: PathwayRiskBand
  risk_breakdown: RiskComponents
  shortfall: number
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

// A stored 0 for these fields means "unset" (a blank form field or an operator-zeroed
// Settings value), not "explicitly disable this floor/fee" — cascade to the next tier
// instead of silently switching a safety gate off (§P0-3).
export function positiveOr(value: number | null | undefined, fallback: number): number {
  return value != null && value > 0 ? value : fallback
}

// ─── Event builder ────────────────────────────────────────────────────────────

function buyEvent(date: string, a: PropertyAssumptions, interestOnly = false, settings?: AssumptionSettings): ScenarioEvent {
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
      legal_fees:         positiveOr(a.legal_fees, 2000),
      arrangement_fee:    positiveOr(a.arrangement_fee, 999),
      valuation_fee:      positiveOr(a.valuation_fee, 300),
      // Transaction-timing model (§P1-6, 2nd review): completion lag + onboarding void.
      completion_lag_months:   a.completion_lag_months   ?? settings?.default_completion_lag_months   ?? 2,
      onboarding_void_months:  a.onboarding_void_months  ?? settings?.default_onboarding_void_months  ?? 1,
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

// Cash-out remortgage targeting a specific property (§P2-11 BRRR) — the engine's
// remortgage handler already charges ERC on an early exit and deducts fees; this just
// builds the event with the new (higher) balance at the target LTV.
//
// property_id is left null: the target may be a property bought earlier in the same
// simulation (no real DB row yet), so it can't go through the FK'd property_id column —
// it rides in parameters_json as sim_property_id instead, which the engine reads as a
// fallback when property_id is null.
function remortgageEvent(
  date: string,
  propertyId: number,
  newBalance: number,
  a: PropertyAssumptions,
  settings?: AssumptionSettings
): ScenarioEvent {
  return {
    event_type: 'remortgage',
    property_id: null,
    date,
    parameters_json: JSON.stringify({
      sim_property_id:     propertyId,
      new_rate:            a.mortgage_rate ?? settings?.default_mortgage_rate_pct ?? 5.5,
      new_term_years:      a.mortgage_term_years ?? 25,
      new_balance:         Math.round(newBalance),
      arrangement_fee:     positiveOr(a.arrangement_fee, positiveOr(settings?.default_arrangement_fee, 999)),
      valuation_fee:       positiveOr(a.valuation_fee, positiveOr(settings?.default_valuation_fee, 300)),
    }),
  }
}

// ─── Cash-gated event generation ──────────────────────────────────────────────
// Decisions (buy / payoff) are driven by the accumulated cash pot — read straight
// from the engine's true-cash `cumulative_cashflow` line — not by fixed timers.
// Greedy forward insertion: re-project after every decision so each subsequent
// choice sees the updated cash balance (deposits/payoffs drawn, loans added).

type Strategy = 'steady' | 'accelerated' | 'de_gear' | 'brrr'

function depositPlusCosts(a: PropertyAssumptions): number {
  const price = a.purchase_price
  const deposit = price * ((a.deposit_percent ?? 25) / 100)
  const { total: txCosts } = calcTransactionCosts(price, positiveOr(a.legal_fees, 2000), 0, positiveOr(a.arrangement_fee, 999), positiveOr(a.valuation_fee, 300))
  return deposit + txCosts
}

// The candidate deal is priced/rented in today's terms; a purchase happening N months into the
// horizon should cost/rent what that deal will actually be by then, not what it costs today —
// otherwise later purchases clear the deposit/ICR gates far too easily (§P0-1).
function indexedAssumptions(a: PropertyAssumptions, propertyGrowthPct: number, rentGrowthPct: number, monthIndex: number): PropertyAssumptions {
  const years = monthIndex / 12
  return {
    ...a,
    purchase_price: a.purchase_price * Math.pow(1 + propertyGrowthPct / 100, years),
    monthly_rent:   a.monthly_rent   * Math.pow(1 + rentGrowthPct / 100, years),
  }
}

function cloneState(initial: Map<number, PropertyState>): Map<number, PropertyState> {
  return new Map(Array.from(initial.entries()).map(([k, v]) => [k, { ...v }]))
}

// Active mortgages at absolute month i, read from property_series — includes each
// balance's ERC exposure so the payoff decision can gate on the true cash impact.
function activeBalancesAt(proj: ProjectionResult, i: number): { debt: number; isEarlyExit: boolean }[] {
  const ym = proj.months[i].date
  const out: { debt: number; isEarlyExit: boolean }[] = []
  for (const ps of proj.property_series) {
    const pm = ps.months.find(m => m.date === ym)
    if (pm && pm.debt > 0) {
      out.push({ debt: pm.debt, isEarlyExit: pm.is_fixed_rate && pm.next_reprice_month != null && i < pm.next_reprice_month })
    }
  }
  return out
}

// Mortgaged properties whose LTV has fallen below the refinance trigger (appreciation +
// amortisation) at absolute month i — candidates for a cash-out remortgage (§P2-11 BRRR).
function refinanceCandidatesAt(
  proj: ProjectionResult, i: number, triggerLtvPct: number
): { property_id: number; debt: number; value: number; ltv: number; isEarlyExit: boolean }[] {
  const ym = proj.months[i].date
  const out: { property_id: number; debt: number; value: number; ltv: number; isEarlyExit: boolean }[] = []
  for (const ps of proj.property_series) {
    const pm = ps.months.find(m => m.date === ym)
    if (pm && pm.debt > 0 && pm.value > 0) {
      const ltv = (pm.debt / pm.value) * 100
      if (ltv < triggerLtvPct) {
        out.push({
          property_id: ps.property_id, debt: pm.debt, value: pm.value, ltv,
          isEarlyExit: pm.is_fixed_rate && pm.next_reprice_month != null && i < pm.next_reprice_month,
        })
      }
    }
  }
  return out
}

// BRRR refinance thresholds (§P2-11): trigger once a property's LTV falls below this via
// appreciation/amortisation, refinance back up to the target LTV — standard UK BTL
// refinance headroom. Strategy-defining constants, not user-configurable (same status as
// the de-gear strategy's ≤2-mortgages cap).
const BRRR_TRIGGER_LTV_PCT = 65
const BRRR_TARGET_LTV_PCT = 75

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
  const capex = positiveOr(goal.capex_reserve_per_property, 1000)
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
  assumptionsJson: string,
  settings?: AssumptionSettings,
  // Hybrid-template support (§P2-8d): resume an already-decided event list under a new
  // strategy from a given month, rather than starting the decision search from scratch.
  // Both default to today's exact from-scratch behaviour for every existing caller.
  seedDecisions: ScenarioEvent[] = [],
  startMonth = 0
): { decisions: ScenarioEvent[]; icrBlocked: { candidateIcrPct: number; icrFloor: number } | null } {
  const totalMonths = projYears * 12
  const config = { base_date: baseDate, projection_years: projYears, tax, starting_cash: startingCash, assumptions_json: assumptionsJson }
  const monthlyExp = a.monthly_expenses ?? 200
  const ercPct = goal.erc_pct ?? 3
  const cap = projYears * 4                                   // hard ceiling on decisions
  const marginGoal = withMargin(goal)

  // Growth rates the candidate deal is indexed against (§P0-1) — same fields/fallback chain
  // scenarioEngine.ts reads for the projection itself, so the deal and the projection age
  // consistently.
  const parsedAssumptions = JSON.parse(assumptionsJson || '{}')
  const propertyGrowthPct = parsedAssumptions.property_growth_pct ?? settings?.default_property_growth_pct ?? 3.0
  const rentGrowthPct     = parsedAssumptions.rent_growth_pct     ?? settings?.default_rent_growth_pct     ?? 2.5

  const icrFloor = positiveOr(goal.min_icr, icrThresholdPct(tax))

  // Lender ICR buy gate (P0 #4): this deal's own rent vs. a stressed interest-only payment on
  // the loan — the same test a real lender applies to one loan at a time, so a single
  // unfinanceable purchase can't be masked by other properties' cashflow. Recomputed per month
  // against the indexed deal (§P0-1) rather than hoisted once, so a later, pricier deal is
  // gated on its own affordability, not month-0's.
  //
  // LTV buy gate (§P0-2): generation must never propose a purchase that would push the
  // portfolio's own aggregate LTV past the goal's mandate — previously only checkConstraints
  // caught this, after the fact, rejecting the whole 15-year pathway instead of the engine
  // simply not proposing the breaching buy in the first place.
  function buyGateAt(monthIndex: number, currentValue: number, currentDebt: number): { buyCost: number; icrOk: boolean; ltvOk: boolean; candidateIcrPct: number } {
    const indexed = indexedAssumptions(a, propertyGrowthPct, rentGrowthPct, monthIndex)
    const stressUplift = (settings?.icr_stress_uplift_bps ?? 200) / 100
    const stressFloor = settings?.icr_stress_floor_pct ?? 5.5
    const stressRate = Math.max((indexed.mortgage_rate ?? settings?.default_mortgage_rate_pct ?? 5.5) + stressUplift, stressFloor)
    const loanAmount = indexed.purchase_price * (1 - (indexed.deposit_percent ?? settings?.default_deposit_percent ?? 25) / 100)
    const candidateIcrPct = loanAmount > 0 ? (indexed.monthly_rent / (loanAmount * stressRate / 100 / 12)) * 100 : Infinity
    let ltvOk = true
    if (goal.max_ltv_pct != null) {
      const prospectiveValue = currentValue + indexed.purchase_price
      const prospectiveLtv = prospectiveValue > 0 ? ((currentDebt + loanAmount) / prospectiveValue) * 100 : 0
      ltvOk = prospectiveLtv <= goal.max_ltv_pct
    }
    // Transaction-timing model (§P1-6, 2nd review): the new property carries a mortgage
    // payment from completion but earns no rent during its onboarding void — the reserve-floor
    // gate must anticipate that near-term cash drag now, not just the upfront deposit/fees,
    // or the "cash never breaches the reserve floor" invariant (P0 #3) would silently break.
    const onboardingVoidMonths = indexed.onboarding_void_months ?? settings?.default_onboarding_void_months ?? 1
    const termMonths = (indexed.mortgage_term_years ?? 25) * 12
    const estimatedMonthlyMortgage = calcMonthlyPayment(loanAmount, indexed.mortgage_rate ?? settings?.default_mortgage_rate_pct ?? 5.5, termMonths)
    const voidDrag = estimatedMonthlyMortgage * onboardingVoidMonths
    const buyCost = depositPlusCosts(indexed) + voidDrag
    return { buyCost, icrOk: candidateIcrPct >= icrFloor, ltvOk, candidateIcrPct }
  }

  const decisions: ScenarioEvent[] = [...seedDecisions]
  // Captures the first month where a buy was blocked purely by the lender ICR test — cash and
  // LTV would otherwise have permitted the purchase — so generatePathways() can report the real
  // reason instead of analyzeBinding()'s realized-portfolio view, which is blind to a candidate
  // deal that was rejected before it ever became an event.
  let icrBlocked: { candidateIcrPct: number; icrFloor: number } | null = null
  let lastMonth = startMonth
  // Earliest month a NEW buy may be decided — advanced past a pending buy's own completion
  // month (§P1-6, 2nd review) so overlapping in-flight purchases can't each pass the LTV/reserve
  // gates against a stale pre-completion snapshot. Scoped to buys only; refinances/payoffs
  // complete instantly and aren't subject to this.
  let nextBuyEligibleMonth = 0

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

      if (strategy === 'de_gear') {
        const balances = activeBalancesAt(proj, i)
        if (balances.length < 2) {
          const { buyCost, icrOk, ltvOk, candidateIcrPct } = buyGateAt(i, proj.months[i].total_value, proj.months[i].total_debt)
          if (i >= nextBuyEligibleMonth && icrOk && ltvOk && cash - buyCost >= reserveFloor(goal, monthlyExp, propCount + 1)) { decided = buyEvent(proj.months[i].date, indexedAssumptions(a, propertyGrowthPct, rentGrowthPct, i), interestOnly, settings); decidedMonth = i; break }
          if (!icrOk && ltvOk && icrBlocked === null && cash - buyCost >= reserveFloor(goal, monthlyExp, propCount + 1)) icrBlocked = { candidateIcrPct, icrFloor }
        } else {
          const target = balances.reduce((min, b) => b.debt < min.debt ? b : min)
          const ercCost = target.isEarlyExit ? target.debt * ercPct / 100 : 0
          if (cash - target.debt - ercCost >= reserveFloor(goal, monthlyExp, propCount)) { decided = payoffEvent(proj.months[i].date); decidedMonth = i; break }
        }
      } else if (strategy === 'brrr') {
        // Refinance first — releasing equity only ever helps the cash position, so no
        // reserve-floor gate is needed here (unlike a buy). Pick the property with the
        // most equity to unlock (lowest LTV), same "pick the extreme" pattern as de-gear.
        const candidates = refinanceCandidatesAt(proj, i, BRRR_TRIGGER_LTV_PCT)
        if (candidates.length > 0) {
          const target = candidates.reduce((min, c) => c.ltv < min.ltv ? c : min)
          // The goal's own LTV mandate can only pull the target down, never above the
          // strategy's own 75% ceiling (§P0-2) — generation must never propose a refinance its
          // own compliance layer (checkConstraints) would reject.
          const targetLtvPct = Math.min(BRRR_TARGET_LTV_PCT, goal.max_ltv_pct ?? BRRR_TARGET_LTV_PCT)
          const newBalance = target.value * (targetLtvPct / 100)
          const ercCost = target.isEarlyExit ? target.debt * ercPct / 100 : 0
          const arrangementFee = positiveOr(a.arrangement_fee, positiveOr(settings?.default_arrangement_fee, 999))
          const valuationFee = positiveOr(a.valuation_fee, positiveOr(settings?.default_valuation_fee, 300))
          const netRelease = (newBalance - target.debt) - ercCost - arrangementFee - valuationFee
          if (netRelease > 0) {
            decided = remortgageEvent(proj.months[i].date, target.property_id, newBalance, a, settings)
            decidedMonth = i
            break
          }
        }
        {
          const { buyCost, icrOk, ltvOk, candidateIcrPct } = buyGateAt(i, proj.months[i].total_value, proj.months[i].total_debt)
          if (i >= nextBuyEligibleMonth && icrOk && ltvOk && cash - buyCost >= reserveFloor(goal, monthlyExp, propCount + 1)) { decided = buyEvent(proj.months[i].date, indexedAssumptions(a, propertyGrowthPct, rentGrowthPct, i), interestOnly, settings); decidedMonth = i; break }
          if (!icrOk && ltvOk && icrBlocked === null && cash - buyCost >= reserveFloor(goal, monthlyExp, propCount + 1)) icrBlocked = { candidateIcrPct, icrFloor }
        }
      } else {
        const { buyCost, icrOk, ltvOk, candidateIcrPct } = buyGateAt(i, proj.months[i].total_value, proj.months[i].total_debt)
        if (i >= nextBuyEligibleMonth && icrOk && ltvOk && cash - buyCost >= reserveFloor(goal, monthlyExp, propCount + 1)) { decided = buyEvent(proj.months[i].date, indexedAssumptions(a, propertyGrowthPct, rentGrowthPct, i), interestOnly, settings); decidedMonth = i; break }
        if (!icrOk && ltvOk && icrBlocked === null && cash - buyCost >= reserveFloor(goal, monthlyExp, propCount + 1)) icrBlocked = { candidateIcrPct, icrFloor }
      }
    }

    if (!decided || decidedMonth < lastMonth) break
    decisions.push(decided)
    // A buy doesn't actually land until completion (§P1-6, 2nd review) — track when the next
    // one may be considered so overlapping in-flight purchases can't each look individually
    // LTV/reserve-compliant against a pre-completion snapshot while collectively breaching the
    // mandate once they all land. Scoped to buys only — refinances/payoffs complete instantly
    // and should keep being evaluated every month (BRRR's refinance cadence doesn't need to
    // wait on an unrelated buy's completion).
    if (decided.event_type === 'buy_property') {
      const decidedParams = JSON.parse(decided.parameters_json)
      const lagMonths = decidedParams.completion_lag_months ?? 0
      nextBuyEligibleMonth = decidedMonth + lagMonths + 1
    }
    lastMonth = decidedMonth + 1   // guarantee forward progress
  }

  return { decisions, icrBlocked }
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

function checkConstraints(months: MonthSnapshot[], goal: Goal, monthlyExp: number = 200, tax?: TaxSettings): boolean {
  // Lender ICR (P0 #4): a hard, always-on real-world constraint — not optional like
  // LTV/cashflow, since it reflects whether a lender would actually approve the deal.
  const icrFloor = positiveOr(goal.min_icr, icrThresholdPct(tax))
  for (const m of months) {
    if (goal.max_ltv_pct != null && m.total_value > 0) {
      const ltv = (m.total_debt / m.total_value) * 100
      if (ltv > goal.max_ltv_pct) return false
    }
    if (m.monthly_icr > 0 && m.monthly_icr < icrFloor) return false
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

// "Reached" requires the goal to hold at the *end* of the horizon, not merely to have been
// touched once and drifted back below it — a plan whose income spikes to target for one month
// and settles back down hasn't actually reached financial independence at that level. Scans
// backward from the final month; monthIndex is the first month of the streak that runs
// uninterrupted through to the end. No-op for count/net_worth (monotonic in this engine's
// pathway generation — first-crossing and last-month-value already coincide); the real fix is
// for income/retirement_date, whose post-tax cashflow can dip below target later (rate
// repricing, or a hybrid's phase-switch cost) after an earlier transient crossing.
function checkGoalReached(months: MonthSnapshot[], goal: Goal): { reached: boolean; monthIndex: number | null } {
  if (months.length === 0) return { reached: false, monthIndex: null }

  const hit = (i: number): boolean => {
    const m = months[i]
    // Income/retirement goals judged on post-tax cash — the real FI number.
    const postTaxMonthly = m.monthly_cashflow_posttax ?? m.monthly_cashflow
    switch (goal.goal_type) {
      case 'income':
        return goal.target_monthly_income != null && postTaxMonthly >= goal.target_monthly_income
      case 'count':
        return goal.target_property_count != null && m.property_count >= goal.target_property_count
      case 'net_worth':
        return goal.target_equity != null && m.total_equity >= goal.target_equity
      case 'mortgage_free':
        return m.total_debt === 0 &&
          (goal.target_date == null || m.date.slice(0, 7) <= goal.target_date.slice(0, 7))
      case 'retirement_date':
        return postTaxMonthly >= 0 &&
          (goal.target_date == null || m.date.slice(0, 7) <= goal.target_date.slice(0, 7))
    }
  }

  const last = months.length - 1
  if (!hit(last)) return { reached: false, monthIndex: null }
  let i = last
  while (i > 0 && hit(i - 1)) i--
  return { reached: true, monthIndex: i }
}

// ─── Ranking: risk score + binding constraint (C3 / §P2-8 Appendix B) ─────────

type Summary = ProjectionResult['summary']

export interface RiskComponents {
  leverage: number
  affordability: number
  amortisation: number
  liquidity: number
  execution: number
  scale: number
}

export type PathwayRiskBand = 'Low' | 'Medium' | 'High' | 'Critical'

export interface RiskScore100 {
  total: number
  band: PathwayRiskBand
  components: RiskComponents
}

function riskBandOf(total: number): PathwayRiskBand {
  if (total <= 25) return 'Low'
  if (total <= 50) return 'Medium'
  if (total <= 75) return 'High'
  return 'Critical'
}

// A default lender-realistic LTV ceiling used only for scoring shape when the goal itself sets
// no mandate — the goal's own max_ltv_pct is always preferred when present.
const DEFAULT_SCORING_LTV_CEILING_PCT = 75

// Bounded 0-100 composite (§P2-8 Appendix B.1), replacing the old unbounded penalty accumulator
// — a leveraged plan could previously score 0 ("riskless"). Six weighted components, each
// clamped to its own share, so the total is always interpretable on its own (0-100) and the
// breakdown explains *why* a plan scores what it does (a bare number invites arguments; a
// breakdown ends them). Calibrated against this project's real committee-review data so the
// four generated strategies land in the bands the board's own risk matrix described.
export function computeRiskScore100(
  months: MonthSnapshot[],
  events: ScenarioEvent[],
  summary: Summary,
  goal: Goal,
  projectionYears: number,
  monthlyExp: number,
  tax?: TaxSettings,
  // Hybrid-template support (§P2-8d): when supplied, lets the amortisation component notice a
  // remortgage that converts a property from interest-only to repayment (e.g. io_then_repay's
  // switch event) — `propertySeriesIds` is property_series's own property_id list in its existing
  // order (pre-existing properties first, then simulated buys in completion order);
  // `existingPropertyCount` is how many of those are pre-existing (not bought this simulation).
  // Omitted by every ordinary single-phase template call — falls back to today's exact
  // buy-events-only behaviour.
  existingPropertyCount?: number,
  propertySeriesIds?: number[]
): RiskScore100 {
  // Leverage: peak LTV vs the goal's own mandate (or a lender-realistic default ceiling when
  // the goal sets none) — 0 at <=30% LTV, full weight at the mandate.
  let maxLtv = 0
  for (const m of months) {
    if (m.total_value > 0) maxLtv = Math.max(maxLtv, (m.total_debt / m.total_value) * 100)
  }
  const ltvCeiling = goal.max_ltv_pct ?? DEFAULT_SCORING_LTV_CEILING_PCT
  const ltvBreach = goal.max_ltv_pct != null && maxLtv > goal.max_ltv_pct
  const leverage = ltvCeiling > 30
    ? Math.max(0, Math.min(25, ((maxLtv - 30) / (ltvCeiling - 30)) * 25))
    : 0

  // Affordability headroom: min ICR vs the same lender floor used for feasibility elsewhere —
  // 0 at >=2.5x floor, full weight at the floor.
  const icrFloor = positiveOr(goal.min_icr, icrThresholdPct(tax))
  const icrRatio = summary.min_icr > 0 ? summary.min_icr / icrFloor : Infinity
  const affordability = isFinite(icrRatio)
    ? Math.max(0, Math.min(25, ((2.5 - icrRatio) / (2.5 - 1)) * 25))
    : 0

  // Amortisation profile: debt-weighted interest-only share, derived from the buy events
  // themselves (no per-property IO tracking survives into property_series) — origination loan
  // amounts, not amortised terminal balances, so this slightly overstates true terminal IO
  // share (repayment loans pay down further over time). A defensible, documented approximation.
  //
  // When propertySeriesIds/existingPropertyCount are supplied, a single forward pass over the
  // (already date-sorted) events also re-classifies any loan a later remortgage converts to
  // repayment (§P2-8d io_then_repay) — without this, a converted loan would still count toward
  // the IO share it no longer carries, hiding the hybrid's entire risk advantage.
  let ioLoanAmount = 0
  let totalLoanAmount = 0
  if (propertySeriesIds != null && existingPropertyCount != null) {
    const loans = new Map<number, { loanAmount: number; isIO: boolean }>()
    let buyIndex = 0
    for (const ev of events) {
      if (ev.event_type === 'buy_property') {
        const p = JSON.parse(ev.parameters_json)
        const price = p.purchase_price ?? 0
        const loanAmount = price * (1 - (p.deposit_percent ?? 25) / 100)
        const propertyId = propertySeriesIds[existingPropertyCount + buyIndex]
        buyIndex++
        if (propertyId != null) loans.set(propertyId, { loanAmount, isIO: !!p.interest_only })
      } else if (ev.event_type === 'remortgage') {
        const p = JSON.parse(ev.parameters_json)
        const targetId = p.sim_property_id
        const existing = targetId != null ? loans.get(targetId) : undefined
        if (existing) existing.isIO = !!p.interest_only
      }
    }
    for (const { loanAmount, isIO } of loans.values()) {
      totalLoanAmount += loanAmount
      if (isIO) ioLoanAmount += loanAmount
    }
  } else {
    for (const ev of events) {
      if (ev.event_type !== 'buy_property') continue
      const p = JSON.parse(ev.parameters_json)
      const price = p.purchase_price ?? 0
      const loan = price * (1 - (p.deposit_percent ?? 25) / 100)
      totalLoanAmount += loan
      if (p.interest_only) ioLoanAmount += loan
    }
  }
  const amortisation = totalLoanAmount > 0 ? (ioLoanAmount / totalLoanAmount) * 15 : 0

  // Liquidity resilience: worst-month reserve headroom — 0 at >=3x the reserve floor, full
  // weight at the floor.
  let minReserveHeadroom = Infinity
  for (const m of months) {
    const cashAvail = m.cumulative_cashflow_posttax ?? m.cumulative_cashflow
    const floor = reserveFloor(goal, monthlyExp, m.property_count)
    const headroom = floor > 0 ? (cashAvail - floor) / floor : 0
    minReserveHeadroom = Math.min(minReserveHeadroom, headroom)
  }
  if (!isFinite(minReserveHeadroom)) minReserveHeadroom = 2
  const liquidity = Math.max(0, Math.min(15, ((2 - minReserveHeadroom) / 2) * 15))

  // Execution intensity: transaction cadence (buys + refinances) per year, saturating near
  // ~3.5/yr — calibrated so a heavy BRRR-style refinance cadence scores near-full.
  const transactionCount = events.filter(e => e.event_type === 'buy_property' || e.event_type === 'remortgage').length
  const eventsPerYear = projectionYears > 0 ? transactionCount / projectionYears : 0
  const execution = Math.max(0, Math.min(10, (eventsPerYear / 3.5) * 10))

  // Operational scale: ending property count, saturating above ~15 units.
  const endingCount = months.length > 0 ? months[months.length - 1].property_count : 0
  const scale = Math.max(0, Math.min(10, (endingCount / 15) * 10))

  const components: RiskComponents = { leverage, affordability, amortisation, liquidity, execution, scale }
  const rawTotal = leverage + affordability + amortisation + liquidity + execution + scale
  // Floor of 5 whenever any capital was actually deployed — no leveraged/executed plan is
  // riskless; a genuine LTV-mandate breach forces the whole plan into the Critical band.
  let total = summary.total_capital_invested > 0 ? Math.max(5, rawTotal) : rawTotal
  if (ltvBreach) total = Math.max(total, 90)
  total = Math.min(100, Math.round(total))

  return { total, band: riskBandOf(total), components }
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
  monthlyExp: number = 200,
  tax?: TaxSettings
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
  if (summary.min_icr > 0) {
    const icrFloor = positiveOr(goal.min_icr, icrThresholdPct(tax))
    cons.push({ key: 'icr', headroom: (summary.min_icr - icrFloor) / icrFloor,
      label: `ICR fell to ${summary.min_icr.toFixed(0)}% vs ${icrFloor.toFixed(0)}% lender floor` })
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

// Rank a set by time-to-goal + risk; flag the recommended pathway according to an explicit,
// user-owned ranking mode (§P2-8 Appendix B.2) rather than a single hidden formula. The base
// sort/rank order is unchanged from before modes existed — only *which* row is flagged
// `recommended` (and why) depends on the mode; 'fastest' reproduces the exact prior behaviour.
export type RankingMode = 'fastest' | 'balanced' | 'safest'

export interface RankablePathway {
  id: number
  feasible: number            // SQLite 0/1
  reaches_goal: number        // SQLite 0/1
  months_to_goal?: number | null
  risk_score?: number | null
  shortfall?: number | null
  summary?: { end_equity?: number } | null
}

export function rankPathways<T extends RankablePathway>(
  rows: T[],
  mode: RankingMode = 'fastest'
): (T & { rank: number; recommended: boolean; recommended_reason?: string })[] {
  const sorted = [...rows].sort((a, b) => {
    const ar = a.reaches_goal ? 0 : 1, br = b.reaches_goal ? 0 : 1
    if (ar !== br) return ar - br
    const am = a.months_to_goal ?? Infinity, bm = b.months_to_goal ?? Infinity
    if (am !== bm) return am - bm
    const arisk = a.risk_score ?? Infinity, brisk = b.risk_score ?? Infinity
    if (arisk !== brisk) return arisk - brisk
    return (b.summary?.end_equity ?? 0) - (a.summary?.end_equity ?? 0)
  })

  const feasibleReaching = sorted.filter(p => p.feasible === 1 && p.reaches_goal === 1)
  const minRisk = (rows_: T[]) => rows_.reduce((best, p) => (p.risk_score ?? Infinity) < (best.risk_score ?? Infinity) ? p : best)

  let recId: number | null = null
  let reason: string | undefined

  if (mode === 'balanced' && feasibleReaching.length > 0) {
    // Within 1.25x the fastest feasible/reaching plan's time-to-goal, then min risk.
    const fastestMonths = Math.min(...feasibleReaching.map(p => p.months_to_goal ?? Infinity))
    const nearFastest = feasibleReaching.filter(p => (p.months_to_goal ?? Infinity) <= fastestMonths * 1.25)
    const winner = minRisk(nearFastest)
    recId = winner.id
    reason = (winner.months_to_goal ?? Infinity) <= fastestMonths
      ? 'Recommended — fastest plan reaching goal'
      : 'Recommended — safest plan within reach of the fastest'
  } else if (mode === 'safest') {
    if (feasibleReaching.length > 0) {
      const winner = minRisk(feasibleReaching)
      recId = winner.id
      reason = 'Recommended — safest plan reaching goal'
    } else {
      // No plan reaches goal within the horizon — fall back to the feasible plan with the
      // least risk, tie-broken by the smallest shortfall from target.
      const feasible = sorted.filter(p => p.feasible === 1)
      if (feasible.length > 0) {
        const winner = feasible.reduce((best, p) => {
          const pRisk = p.risk_score ?? Infinity, bRisk = best.risk_score ?? Infinity
          if (pRisk !== bRisk) return pRisk < bRisk ? p : best
          return (p.shortfall ?? Infinity) < (best.shortfall ?? Infinity) ? p : best
        })
        recId = winner.id
        reason = 'Closest safe plan — goal not met'
      }
    }
  }

  if (recId == null) {
    // 'fastest' mode (or balanced/safest with nothing to recommend) — unchanged prior
    // behaviour: the first feasible row after the base sort.
    recId = sorted.find(p => p.feasible === 1)?.id ?? null
    if (recId != null && mode !== 'fastest') reason = 'Recommended — fastest feasible plan'
  }

  return sorted.map((p, i) => ({
    ...p, rank: i + 1, recommended: p.id === recId,
    recommended_reason: p.id === recId ? reason : undefined,
  }))
}

// ─── Main export ──────────────────────────────────────────────────────────────

export interface StrategyTemplate {
  template_name: string
  label: string
  strategy: Strategy
  stopAtGoal: boolean
  interestOnly: boolean
}

// Efficient frontier: four genuinely distinct strategies.
//  • Target & Hold  — repayment, stop at goal (fewest units, debt amortises, then holds)
//  • Maximise Cashflow — interest-only, grow (most income / fastest, highest rate risk)
//  • Low-Risk Hold — repayment + payoffs, grow (lowest debt, most resilient; de-gears —
//    previously mislabelled "Mortgage Recycler" §P2-11)
//  • BRRR — repayment + cash-out remortgages once a property's LTV falls below 65%,
//    grow (never de-levers; the genuine equity-recycling strategy §P2-11)
export const TEMPLATES: StrategyTemplate[] = [
  { template_name: 'target_hold',    label: 'Target & Hold',     strategy: 'steady',   stopAtGoal: true,  interestOnly: false },
  { template_name: 'max_cashflow',   label: 'Maximise Cashflow', strategy: 'steady',   stopAtGoal: false, interestOnly: true  },
  { template_name: 'low_risk_hold',  label: 'Low-Risk Hold',     strategy: 'de_gear',  stopAtGoal: false, interestOnly: false },
  { template_name: 'brrr_recycler',  label: 'BRRR',              strategy: 'brrr',     stopAtGoal: false, interestOnly: false },
]

// Runs a single strategy template end-to-end: cash-gated event generation, projection,
// feasibility/goal/risk/binding-constraint analysis. Extracted from generatePathways() so
// nearestFix.ts can re-invoke exactly one template (with a perturbed goal/assumptions) per
// probe, rather than regenerating all four templates for every lever tried (§P2-8c).
export function runTemplate(
  t: StrategyTemplate,
  goal: Goal,
  initialState: Map<number, PropertyState>,
  assumptions: PropertyAssumptions,
  projectionYears: number,
  tax?: TaxSettings,
  settings?: AssumptionSettings
): GeneratedPathway {
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
    property_growth_pct: settings?.default_property_growth_pct ?? 3.0,
    rent_growth_pct: settings?.default_rent_growth_pct ?? 2.5,
    expense_inflation_pct: settings?.default_expense_inflation_pct ?? 2.5,
    void_months_per_year: settings?.default_void_months_per_year ?? 1,
    mortgage_reprice_years: goal.mortgage_reprice_years ?? 5,
    mortgage_reprice_uplift_bps: goal.mortgage_reprice_uplift_bps ?? 200,
    erc_pct: goal.erc_pct ?? 3,
    capex_cycle_years: settings?.capex_cycle_years ?? 10,
    capex_cost_per_property: positiveOr(settings?.capex_cost_per_property, 3000),
    arrears_pct: settings?.arrears_pct ?? 1.5,
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

  // Cash-gated decisions (buys/payoffs), then merge loan events for the final run
  const { decisions, icrBlocked } = buildCashGatedEvents(t.strategy, baseDate, projectionYears, assumptions, initialState, loanEvents, tax, goal, t.stopAtGoal, t.interestOnly, startingCash, assumptionsJson, settings)
  const allEvents = [...decisions, ...loanEvents].sort((a, b) => a.date.localeCompare(b.date))

  const results = buildProjection(cloneState(initialState), allEvents, config) as ProjectionResult
  const feasible = checkConstraints(results.months, goal, monthlyExp, tax) && results.summary.min_cumulative_cashflow >= 0
  const { reached, monthIndex } = checkGoalReached(results.months, goal)

  const risk100 = computeRiskScore100(results.months, allEvents, results.summary, goal, projectionYears, monthlyExp, tax, initialState.size, results.property_series.map(ps => ps.property_id))

  // No purchase was ever made, and the reason was the candidate deal itself failing the
  // lender ICR stress test (not cash/LTV) — analyzeBinding() only sees the realized,
  // unchanged portfolio in that case and would otherwise misreport "deposit capital" as the
  // limiter, when the deal was never financeable to begin with.
  let binding_constraint: string
  let binding_detail: string
  if (decisions.length === 0 && icrBlocked != null) {
    binding_constraint = 'icr'
    binding_detail = `Limited by lender affordability — this candidate deal's stressed ICR (${icrBlocked.candidateIcrPct.toFixed(0)}%) never clears your ${icrBlocked.icrFloor.toFixed(0)}% lender floor. Try a higher-yielding deal, a bigger deposit, or relax the goal's Min Lender ICR.`
  } else {
    const binding = analyzeBinding(goal, results.months, results.summary, reached, depositPlusCosts(assumptions), monthlyExp, tax)
    binding_constraint = binding.key
    binding_detail = binding.detail
  }
  if (t.interestOnly) binding_detail = `Interest-only — rate-exposed, debt not amortised. ${binding_detail}`

  const shortfall = reached ? 0 : computeShortfall(goal, results)

  return {
    template_name: t.template_name,
    label: t.label,
    events: allEvents,
    results,
    feasible,
    reaches_goal: reached,
    months_to_goal: monthIndex,
    risk_score: risk100.total,
    risk_band: risk100.band,
    risk_breakdown: risk100.components,
    shortfall,
    binding_constraint,
    binding_detail,
    assumptions_json: assumptionsJson,
  }
}

// ─── Hybrid strategy templates (§P2-8d / Appendix D.2) ────────────────────────
// Named, explainable two-phase strategies — not a black-box optimiser — composed entirely from
// the existing single-phase decision loops with one stated switch rule each, per the appendix.

export interface HybridTemplate {
  template_name: string
  label: string
  phase1TemplateName: string   // must exist in TEMPLATES
  phase2: 'repay_switch' | 'degear'
}

export const HYBRID_TEMPLATES: HybridTemplate[] = [
  // "Fast Build, Then Lock In": build fast on interest-only, then convert every outstanding IO
  // loan to repayment once the goal is met — answers §13's own "IO early, switch to repayment
  // at goal" example directly.
  { template_name: 'io_then_repay',    label: 'Fast Build, Then Lock In', phase1TemplateName: 'max_cashflow',  phase2: 'repay_switch' },
  // "Recycle, Then De-Risk": BRRR-recycle equity to build, then spend the back half of the plan
  // de-levering — the strategy an experienced BRRR operator actually describes, which neither
  // BRRR (never de-levers) nor Low-Risk Hold (never recycles) captures alone.
  { template_name: 'brrr_then_degear', label: 'Recycle, Then De-Risk',    phase1TemplateName: 'brrr_recycler', phase2: 'degear' },
]

// Runs one hybrid: phase 1 is its base template's own decision loop, forced to stop at the goal
// month (regardless of that template's own stopAtGoal setting) so the switch has a clean cutoff;
// phase 2 either inserts repayment-conversion events (repay_switch) or resumes the same decision
// search under de_gear from that month (degear). Returns null when phase 1 never reaches goal
// (no switch point exists — the hybrid would just duplicate its base template) or when phase 2
// has nothing to add (the hybrid would be identical to phase 1 alone) — both per the appendix's
// degeneration/dedup rules, so the frontier chart and ranking never see a duplicate pathway.
export function runHybridTemplate(
  h: HybridTemplate,
  goal: Goal,
  initialState: Map<number, PropertyState>,
  assumptions: PropertyAssumptions,
  projectionYears: number,
  tax?: TaxSettings,
  settings?: AssumptionSettings
): GeneratedPathway | null {
  const phase1Template = TEMPLATES.find(t => t.template_name === h.phase1TemplateName)
  if (!phase1Template) return null

  const baseDate = new Date().toISOString().slice(0, 10)
  const monthlyExp = assumptions.monthly_expenses ?? 200
  const startingCash = goal.starting_cash ?? reserveFloor(goal, monthlyExp, initialState.size)
  const assumptionsJson = JSON.stringify({
    property_growth_pct: settings?.default_property_growth_pct ?? 3.0,
    rent_growth_pct: settings?.default_rent_growth_pct ?? 2.5,
    expense_inflation_pct: settings?.default_expense_inflation_pct ?? 2.5,
    void_months_per_year: settings?.default_void_months_per_year ?? 1,
    mortgage_reprice_years: goal.mortgage_reprice_years ?? 5,
    mortgage_reprice_uplift_bps: goal.mortgage_reprice_uplift_bps ?? 200,
    erc_pct: goal.erc_pct ?? 3,
    capex_cycle_years: settings?.capex_cycle_years ?? 10,
    capex_cost_per_property: positiveOr(settings?.capex_cost_per_property, 3000),
    arrears_pct: settings?.arrears_pct ?? 1.5,
  })
  const config = { base_date: baseDate, projection_years: projectionYears, tax, starting_cash: startingCash, assumptions_json: assumptionsJson }
  const loanEvents = goal.director_loan_annual
    ? buildDirectorLoanEvents(baseDate, projectionYears, goal.director_loan_annual, goal.director_loan_start_date)
    : []

  // Phase 1: the base strategy, stopped at goal so the switch has a clean cutoff.
  const { decisions: phase1Decisions } = buildCashGatedEvents(
    phase1Template.strategy, baseDate, projectionYears, assumptions, initialState, loanEvents, tax, goal,
    /* stopAtGoal */ true, phase1Template.interestOnly, startingCash, assumptionsJson, settings
  )
  const phase1Events = [...phase1Decisions, ...loanEvents].sort((a, b) => a.date.localeCompare(b.date))
  const phase1Results = buildProjection(cloneState(initialState), phase1Events, config) as ProjectionResult
  const { reached: phase1Reached, monthIndex: m } = checkGoalReached(phase1Results.months, withMargin(goal))
  if (!phase1Reached || m == null) return null   // Degeneration: no switch point exists.

  let finalDecisions: ScenarioEvent[]
  if (h.phase2 === 'repay_switch') {
    const switchDate = phase1Results.months[m].date
    const switchEvents: ScenarioEvent[] = []
    for (let idx = initialState.size; idx < phase1Results.property_series.length; idx++) {
      const ps = phase1Results.property_series[idx]
      const pm = ps.months.find(mo => mo.date === switchDate)
      if (pm && pm.debt > 0) {
        switchEvents.push(remortgageEvent(switchDate, ps.property_id, pm.debt, assumptions, settings))
      }
    }
    if (switchEvents.length === 0) return null   // Dedup: nothing to convert, identical to phase 1.
    finalDecisions = [...phase1Decisions, ...switchEvents]
  } else {
    const { decisions: phase2Decisions } = buildCashGatedEvents(
      'de_gear', baseDate, projectionYears, assumptions, initialState, loanEvents, tax, goal,
      /* stopAtGoal */ false, /* interestOnly */ false, startingCash, assumptionsJson, settings,
      phase1Decisions, m
    )
    if (phase2Decisions.length === phase1Decisions.length) return null   // Dedup: phase 2 added nothing.
    finalDecisions = phase2Decisions
  }

  const allEvents = [...finalDecisions, ...loanEvents].sort((a, b) => a.date.localeCompare(b.date))
  const results = buildProjection(cloneState(initialState), allEvents, config) as ProjectionResult
  const feasible = checkConstraints(results.months, goal, monthlyExp, tax) && results.summary.min_cumulative_cashflow >= 0
  const { reached, monthIndex } = checkGoalReached(results.months, goal)
  const risk100 = computeRiskScore100(results.months, allEvents, results.summary, goal, projectionYears, monthlyExp, tax, initialState.size, results.property_series.map(ps => ps.property_id))
  const binding = analyzeBinding(goal, results.months, results.summary, reached, depositPlusCosts(assumptions), monthlyExp, tax)
  const shortfall = reached ? 0 : computeShortfall(goal, results)

  return {
    template_name: h.template_name,
    label: h.label,
    events: allEvents,
    results,
    feasible,
    reaches_goal: reached,
    months_to_goal: monthIndex,
    risk_score: risk100.total,
    risk_band: risk100.band,
    risk_breakdown: risk100.components,
    shortfall,
    binding_constraint: binding.key,
    binding_detail: binding.detail,
    assumptions_json: assumptionsJson,
  }
}

export function generatePathways(
  goal: Goal,
  initialState: Map<number, PropertyState>,
  assumptions: PropertyAssumptions,
  projectionYears: number,
  _activeMortgageCount: number,  // retained for API stability; recycler now reads live debt
  tax?: TaxSettings,             // global tax settings → post-tax goal solving
  settings?: AssumptionSettings  // global assumption defaults (growth/void/inflation/ICR stress)
): GeneratedPathway[] {
  const basePathways = TEMPLATES.map(t => runTemplate(t, goal, initialState, assumptions, projectionYears, tax, settings))
  const hybridPathways = HYBRID_TEMPLATES
    .map(h => runHybridTemplate(h, goal, initialState, assumptions, projectionYears, tax, settings))
    .filter((p): p is GeneratedPathway => p != null)
  return [...basePathways, ...hybridPathways]
}

// Goal-specific distance from target when a pathway doesn't reach it — the Safest ranking
// mode's fallback tie-break when no plan reaches goal within the horizon (§P2-8). Date-based
// goals (mortgage_free/retirement_date) have no continuous distance metric, so shortfall is 0
// for those — feasibility/reaches_goal already carries the meaningful signal there.
function computeShortfall(goal: Goal, results: ProjectionResult): number {
  const last = results.months[results.months.length - 1]
  if (!last) return 0
  switch (goal.goal_type) {
    case 'income': {
      if (goal.target_monthly_income == null) return 0
      const ending = last.monthly_cashflow_posttax ?? last.monthly_cashflow
      return Math.max(0, goal.target_monthly_income - ending)
    }
    case 'count':
      return goal.target_property_count != null ? Math.max(0, goal.target_property_count - last.property_count) : 0
    case 'net_worth':
      return goal.target_equity != null ? Math.max(0, goal.target_equity - last.total_equity) : 0
    default:
      return 0
  }
}

export { monthDiff }
