import { buildProjection, type PropertyState, type ScenarioEvent } from './scenarioEngine.ts'

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

type ProjectionResult = {
  months: MonthSnapshot[]
  property_series: unknown[]
  summary: {
    start_equity: number
    end_equity: number
    equity_growth: number
    equity_growth_pct: number
    total_cashflow: number
    avg_monthly_cashflow: number
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

// ─── Template 1: Steady Growth ────────────────────────────────────────────────
// Buy 1 property every 12 months, starting at +3 months

function buildSteadyGrowthEvents(baseDate: string, projYears: number, a: PropertyAssumptions): ScenarioEvent[] {
  const events: ScenarioEvent[] = []
  const totalMonths = projYears * 12
  for (let mo = 3; mo < totalMonths; mo += 12) {
    events.push(buyEvent(addMonths(baseDate, mo), a))
  }
  return events
}

// ─── Template 2: Accelerated Growth ──────────────────────────────────────────
// Buy 1 property every 6 months, starting at +3 months

function buildAcceleratedEvents(baseDate: string, projYears: number, a: PropertyAssumptions): ScenarioEvent[] {
  const events: ScenarioEvent[] = []
  const totalMonths = projYears * 12
  for (let mo = 3; mo < totalMonths; mo += 6) {
    events.push(buyEvent(addMonths(baseDate, mo), a))
  }
  return events
}

// ─── Template 3: Mortgage Recycler ───────────────────────────────────────────
// Keep ≤2 active mortgages. When at 2, payoff the smallest after 18 months then buy.
// Mirrors create-scenarios.ts lines 58–116.

function buildMortgageRecyclerEvents(
  baseDate: string,
  projYears: number,
  a: PropertyAssumptions,
  initialMortgageCount: number
): ScenarioEvent[] {
  const events: ScenarioEvent[] = []
  const totalMonths = projYears * 12
  let activeMortgages = Math.min(initialMortgageCount, 2)
  let cursor = 3 // months from base_date

  while (cursor < totalMonths) {
    if (activeMortgages < 2) {
      events.push(buyEvent(addMonths(baseDate, cursor), a))
      activeMortgages++
      cursor += 3  // small gap before next decision
    } else {
      // Hold for 18 months then payoff the smallest (pid:null = auto-select)
      cursor += 18
      if (cursor >= totalMonths) break
      events.push(payoffEvent(addMonths(baseDate, cursor)))
      activeMortgages--
      cursor += 1
    }
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
  activeMortgageCount: number
): GeneratedPathway[] {
  const baseDate = new Date().toISOString().slice(0, 10)

  const config = {
    base_date: baseDate,
    projection_years: projectionYears,
  }

  const templates: Array<{ template_name: string; label: string; events: ScenarioEvent[] }> = [
    {
      template_name: 'steady_growth',
      label: 'Steady Growth',
      events: buildSteadyGrowthEvents(baseDate, projectionYears, assumptions),
    },
    {
      template_name: 'accelerated_growth',
      label: 'Accelerated Growth',
      events: buildAcceleratedEvents(baseDate, projectionYears, assumptions),
    },
    {
      template_name: 'mortgage_recycler',
      label: 'Mortgage Recycler',
      events: buildMortgageRecyclerEvents(baseDate, projectionYears, assumptions, activeMortgageCount),
    },
  ]

  return templates.map(t => {
    // Deep-clone initialState for each run so templates don't share state
    const stateCopy = new Map<number, PropertyState>(
      Array.from(initialState.entries()).map(([k, v]) => [k, { ...v }])
    )
    const results = buildProjection(stateCopy, t.events, config) as ProjectionResult
    const feasible = checkConstraints(results.months, goal)
    const { reached, monthIndex } = checkGoalReached(results.months, goal)

    return {
      template_name: t.template_name,
      label: t.label,
      events: t.events,
      results,
      feasible,
      reaches_goal: reached,
      months_to_goal: monthIndex,
    }
  })
}

export { monthDiff }
