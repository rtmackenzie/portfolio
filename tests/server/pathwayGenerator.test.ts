import { describe, it, expect } from 'vitest'
import {
  generatePathways,
  computeRiskScore,
  analyzeBinding,
  rankPathways,
  type RankablePathway,
} from '../../server/services/pathwayGenerator.ts'
import type { PropertyState } from '../../server/services/scenarioEngine.ts'
import { DEFAULT_TAX_SETTINGS } from '../../server/services/tax.ts'

const TAX_PERSONAL = { ...DEFAULT_TAX_SETTINGS, ownership: 'personal' as const, personal_marginal_rate_pct: 40 }

// ─── C3 test helpers ────────────────────────────────────────────────────────────

function makeSummary(over: Partial<{
  start_equity: number; end_equity: number; equity_growth: number; equity_growth_pct: number
  total_cashflow: number; avg_monthly_cashflow: number; ending_monthly_cashflow: number
  min_dscr: number; months_below_dscr: number; min_cumulative_cashflow: number
}> = {}) {
  return {
    start_equity: 100000, end_equity: 500000, equity_growth: 400000, equity_growth_pct: 400,
    total_cashflow: 50000, avg_monthly_cashflow: 1000, ending_monthly_cashflow: 2000,
    min_dscr: 2.0, months_below_dscr: 0, min_cumulative_cashflow: 10000,
    ...over,
  }
}

function makeMonth(over: Partial<{
  date: string; total_value: number; total_debt: number; total_equity: number
  monthly_cashflow: number; cumulative_cashflow: number; property_count: number; monthly_dscr: number
}> = {}) {
  return {
    date: '2030-01', total_value: 400000, total_debt: 200000, total_equity: 200000,
    monthly_cashflow: 1500, cumulative_cashflow: 20000, property_count: 4, monthly_dscr: 1.8,
    ...over,
  }
}

// One cashflow-positive property so the cash pot grows slowly without loans
function startingPortfolio(): Map<number, PropertyState> {
  return new Map([[1, {
    id: 1,
    value: 200000,
    monthly_rent: 1200,
    monthly_mortgage: 600,
    monthly_other_expenses: 100,
    debt: 120000,
    is_vacant: false,
    mortgage_rate: 5.5,
    is_interest_only: false,
    purchase_price: 150000,
  }]])
}

const ASSUMPTIONS = {
  purchase_price: 100000,
  monthly_rent: 800,
  monthly_expenses: 200,
  deposit_percent: 25,
  mortgage_rate: 5.5,
  mortgage_term_years: 25,
}

const PROJECTION_YEARS = 15

function buyCount(events: { event_type: string }[]): number {
  return events.filter(e => e.event_type === 'buy_property').length
}

function firstBuyDate(events: { event_type: string; date: string }[]): string | undefined {
  return events.filter(e => e.event_type === 'buy_property').map(e => e.date).sort()[0]
}

describe('generatePathways — goal solver uses post-tax cashflow', () => {
  const incomeGoal = {
    goal_type: 'income' as const,
    target_monthly_income: 1500,
    director_loan_annual: 60000,
  }

  it('an income goal is reached no sooner once tax is applied', () => {
    const untaxed = generatePathways(incomeGoal, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1)
    const taxed = generatePathways(incomeGoal, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1, TAX_PERSONAL)

    const pick = (ps: ReturnType<typeof generatePathways>) =>
      ps.find(p => p.template_name === 'accelerated_growth')!
    const u = pick(untaxed).months_to_goal ?? Infinity
    const t = pick(taxed).months_to_goal ?? Infinity
    expect(t).toBeGreaterThanOrEqual(u)
  })

  it('post-tax ending cashflow is below pre-tax under personal tax', () => {
    const taxed = generatePathways(incomeGoal, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1, TAX_PERSONAL)
    const p = taxed.find(x => x.template_name === 'steady_growth')!
    expect(p.results.summary.ending_monthly_cashflow_posttax)
      .toBeLessThan(p.results.summary.ending_monthly_cashflow)
    expect(p.results.summary.total_tax_paid).toBeGreaterThan(0)
  })
})

describe('generatePathways — director loans drive the schedule', () => {
  const baseGoal = {
    goal_type: 'count' as const,
    target_property_count: 5,
  }

  it('a larger director loan yields more purchases (steady growth)', () => {
    const small = generatePathways({ ...baseGoal, director_loan_annual: 15000 }, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1)
    const large = generatePathways({ ...baseGoal, director_loan_annual: 200000 }, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1)

    const steadySmall = small.find(p => p.template_name === 'steady_growth')!
    const steadyLarge = large.find(p => p.template_name === 'steady_growth')!

    expect(buyCount(steadyLarge.events)).toBeGreaterThan(buyCount(steadySmall.events))
  })

  it('a larger director loan brings the first purchase forward', () => {
    const small = generatePathways({ ...baseGoal, director_loan_annual: 15000 }, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1)
    const large = generatePathways({ ...baseGoal, director_loan_annual: 200000 }, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1)

    const firstSmall = firstBuyDate(small.find(p => p.template_name === 'accelerated_growth')!.events)!
    const firstLarge = firstBuyDate(large.find(p => p.template_name === 'accelerated_growth')!.events)!

    expect(firstLarge < firstSmall).toBe(true)
  })

  it('a larger director loan reaches a count goal sooner (or at all)', () => {
    const small = generatePathways({ ...baseGoal, director_loan_annual: 15000 }, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1)
    const large = generatePathways({ ...baseGoal, director_loan_annual: 200000 }, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1)

    const accelLarge = large.find(p => p.template_name === 'accelerated_growth')!
    const accelSmall = small.find(p => p.template_name === 'accelerated_growth')!

    expect(accelLarge.reaches_goal).toBe(true)
    if (accelSmall.reaches_goal && accelSmall.months_to_goal != null && accelLarge.months_to_goal != null) {
      expect(accelLarge.months_to_goal).toBeLessThan(accelSmall.months_to_goal)
    }
  })

  it('no purchases are scheduled before the cash pot can afford a deposit', () => {
    // No loans, no starting cash buffer beyond modest rental surplus → first buy is delayed
    const result = generatePathways({ ...baseGoal }, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1)
    const steady = result.find(p => p.template_name === 'steady_growth')!
    const first = firstBuyDate(steady.events)
    // If a buy happens at all, it must be after enough months for the surplus to fund a deposit
    if (first) {
      expect(first > '2026-06').toBe(true)
    }
  })
})

// ─── C3: ranking + binding constraint ────────────────────────────────────────────

describe('computeRiskScore', () => {
  it('a liquidity breach scores far riskier than a clean run', () => {
    const clean = computeRiskScore(makeSummary())
    const breach = computeRiskScore(makeSummary({ min_cumulative_cashflow: -1 }))
    expect(breach).toBeGreaterThan(clean + 50)
  })

  it('more months below the DSCR floor increases risk', () => {
    const few = computeRiskScore(makeSummary({ months_below_dscr: 1 }))
    const many = computeRiskScore(makeSummary({ months_below_dscr: 10 }))
    expect(many).toBeGreaterThan(few)
  })

  it('a thin DSCR cushion adds risk; a comfortable one does not', () => {
    const thin = computeRiskScore(makeSummary({ min_dscr: 1.1 }))   // below 1.5 ⇒ penalty
    const comfy = computeRiskScore(makeSummary({ min_dscr: 2.0 }))  // above 1.5 ⇒ none
    expect(thin).toBeGreaterThan(comfy)
    expect(comfy).toBe(0)
  })
})

describe('analyzeBinding', () => {
  it('flags a DSCR breach as the binding constraint (infeasible)', () => {
    const goal = { goal_type: 'count' as const, min_dscr: 1.25 }
    const months = [makeMonth({ monthly_dscr: 1.08 })]
    const summary = makeSummary({ min_dscr: 1.08 })
    const b = analyzeBinding(goal, months, summary, false, 30000)
    expect(b.key).toBe('dscr')
    expect(b.detail).toMatch(/Infeasible/i)
  })

  it('reports deposit capital as the limiter when constraints have ample slack', () => {
    // Generous constraints, healthy LTV/DSCR/liquidity, but goal not reached → capital-limited
    const goal = { goal_type: 'count' as const, max_ltv_pct: 95, min_dscr: 1.0 }
    const months = [makeMonth({ total_value: 500000, total_debt: 200000, monthly_dscr: 2.5 })]
    const summary = makeSummary({ min_dscr: 2.5, min_cumulative_cashflow: 80000 })
    const b = analyzeBinding(goal, months, summary, false, 30000)
    expect(b.key).toBe('capital')
  })

  it('a goal reached with ample slack is not marked infeasible', () => {
    const goal = { goal_type: 'count' as const, max_ltv_pct: 95 }
    const months = [makeMonth({ total_value: 500000, total_debt: 150000 })]
    const summary = makeSummary({ min_cumulative_cashflow: 50000 })
    const b = analyzeBinding(goal, months, summary, true, 30000)
    expect(b.detail).not.toMatch(/Infeasible/i)
  })
})

describe('rankPathways', () => {
  const base = (over: Partial<RankablePathway> & { id: number }): RankablePathway => ({
    feasible: 1, reaches_goal: 1, months_to_goal: 60, risk_score: 0,
    summary: { end_equity: 100000 }, ...over,
  })

  it('ranks a sooner, lower-risk goal-reaching pathway #1 and recommends it', () => {
    const rows = [
      base({ id: 1, reaches_goal: 0, months_to_goal: null, risk_score: 5 }),
      base({ id: 2, months_to_goal: 48, risk_score: 2 }),   // sooner + low risk → best
      base({ id: 3, months_to_goal: 90, risk_score: 1 }),
    ]
    const ranked = rankPathways(rows)
    expect(ranked[0].id).toBe(2)
    expect(ranked[0].rank).toBe(1)
    expect(ranked.find(r => r.id === 2)!.recommended).toBe(true)
    expect(ranked.find(r => r.id === 1)!.rank).toBe(3) // goal-not-reached sinks to the bottom
  })

  it('never recommends an infeasible pathway, even if it reaches the goal soonest', () => {
    const rows = [
      base({ id: 1, feasible: 0, months_to_goal: 24 }),   // fastest but infeasible
      base({ id: 2, feasible: 1, months_to_goal: 60 }),
    ]
    const ranked = rankPathways(rows)
    expect(ranked[0].id).toBe(1)            // still ranked first by time-to-goal
    expect(ranked[0].recommended).toBe(false)
    expect(ranked.find(r => r.id === 2)!.recommended).toBe(true)
  })
})
