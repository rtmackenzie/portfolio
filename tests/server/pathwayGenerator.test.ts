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
  min_icr: number; months_below_icr: number; min_cumulative_cashflow: number
}> = {}) {
  return {
    start_equity: 100000, end_equity: 500000, equity_growth: 400000, equity_growth_pct: 400,
    total_cashflow: 50000, avg_monthly_cashflow: 1000, ending_monthly_cashflow: 2000,
    min_icr: 200, months_below_icr: 0, min_cumulative_cashflow: 10000,
    ...over,
  }
}

function makeMonth(over: Partial<{
  date: string; total_value: number; total_debt: number; total_equity: number
  monthly_cashflow: number; cumulative_cashflow: number; property_count: number; monthly_icr: number
}> = {}) {
  return {
    date: '2030-01', total_value: 400000, total_debt: 200000, total_equity: 200000,
    monthly_cashflow: 1500, cumulative_cashflow: 20000, property_count: 4, monthly_icr: 180,
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
      ps.find(p => p.template_name === 'max_cashflow')!
    const u = pick(untaxed).months_to_goal ?? Infinity
    const t = pick(taxed).months_to_goal ?? Infinity
    expect(t).toBeGreaterThanOrEqual(u)
  })

  it('post-tax ending cashflow is below pre-tax under personal tax', () => {
    const taxed = generatePathways(incomeGoal, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1, TAX_PERSONAL)
    const p = taxed.find(x => x.template_name === 'max_cashflow')!
    expect(p.results.summary.ending_monthly_cashflow_posttax)
      .toBeLessThan(p.results.summary.ending_monthly_cashflow)
    expect(p.results.summary.total_tax_paid).toBeGreaterThan(0)
  })
})

describe('generatePathways — mixed frontier (solve-and-stop)', () => {
  it('Target & Hold stops at the goal; the growth plans run to the horizon', () => {
    // Count goal: tax-independent and reached early, so the stop is clean to assert.
    const goal = { goal_type: 'count' as const, target_property_count: 5, director_loan_annual: 200000 }
    const ps = generatePathways(goal, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1)
    const hold = ps.find(p => p.template_name === 'target_hold')!
    const grow = ps.find(p => p.template_name === 'max_cashflow')!
    expect(hold.reaches_goal).toBe(true)
    // Target & Hold buys the minimum to reach 5 properties; the growth plan keeps acquiring.
    expect(buyCount(hold.events)).toBeLessThan(buyCount(grow.events))
    expect(hold.results.months[hold.results.months.length - 1].property_count).toBe(5)
  })
})

describe('generatePathways — interest-only frontier (P1 #7)', () => {
  it('Maximise Cashflow finances interest-only and never amortises its debt', () => {
    const goal = { goal_type: 'count' as const, target_property_count: 5, director_loan_annual: 200000 }
    const ps = generatePathways(goal, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1)
    const io = ps.find(p => p.template_name === 'max_cashflow')!
    const buy = io.events.find(e => e.event_type === 'buy_property')!
    expect(JSON.parse(buy.parameters_json).interest_only).toBe(true)
  })

  it('interest-only is post-tax viable under S24 where repayment struggles', () => {
    // S24 taxes rent-minus-expenses but only 20%-credits interest → repayment BTL is
    // often post-tax negative; interest-only keeps more monthly cash, so it reaches sooner.
    const goal = { goal_type: 'income' as const, target_monthly_income: 1200, director_loan_annual: 120000 }
    const ps = generatePathways(goal, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1, TAX_PERSONAL)
    const io = ps.find(p => p.template_name === 'max_cashflow')!
    const hold = ps.find(p => p.template_name === 'target_hold')!
    expect(io.reaches_goal).toBe(true)
    const ioM = io.months_to_goal ?? Infinity
    const holdM = hold.months_to_goal ?? Infinity
    expect(ioM).toBeLessThanOrEqual(holdM)
  })

  it('interest-only is penalised and flagged so it cannot rank as safest', () => {
    const goal = { goal_type: 'count' as const, target_property_count: 6, director_loan_annual: 200000 }
    const ps = generatePathways(goal, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1)
    const io = ps.find(p => p.template_name === 'max_cashflow')!
    const recycler = ps.find(p => p.template_name === 'mortgage_recycler')!
    expect(io.risk_score).toBeGreaterThan(recycler.risk_score)
    expect(io.binding_detail).toMatch(/interest-only/i)
  })

  it('the three strategies produce genuinely different portfolios', () => {
    const goal = { goal_type: 'count' as const, target_property_count: 6, director_loan_annual: 200000 }
    const ps = generatePathways(goal, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1)
    const endDebt = (name: string) => {
      const m = ps.find(p => p.template_name === name)!.results.months
      return m[m.length - 1].total_debt
    }
    const debts = [endDebt('target_hold'), endDebt('max_cashflow'), endDebt('mortgage_recycler')]
    expect(new Set(debts).size).toBe(3) // all distinct ending debt levels
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

    const steadySmall = small.find(p => p.template_name === 'max_cashflow')!
    const steadyLarge = large.find(p => p.template_name === 'max_cashflow')!

    expect(buyCount(steadyLarge.events)).toBeGreaterThan(buyCount(steadySmall.events))
  })

  it('a larger director loan brings the first purchase forward', () => {
    const small = generatePathways({ ...baseGoal, director_loan_annual: 15000 }, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1)
    const large = generatePathways({ ...baseGoal, director_loan_annual: 200000 }, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1)

    const firstSmall = firstBuyDate(small.find(p => p.template_name === 'max_cashflow')!.events)!
    const firstLarge = firstBuyDate(large.find(p => p.template_name === 'max_cashflow')!.events)!

    expect(firstLarge < firstSmall).toBe(true)
  })

  it('a larger director loan reaches a count goal sooner (or at all)', () => {
    const small = generatePathways({ ...baseGoal, director_loan_annual: 15000 }, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1)
    const large = generatePathways({ ...baseGoal, director_loan_annual: 200000 }, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1)

    const accelLarge = large.find(p => p.template_name === 'max_cashflow')!
    const accelSmall = small.find(p => p.template_name === 'max_cashflow')!

    expect(accelLarge.reaches_goal).toBe(true)
    if (accelSmall.reaches_goal && accelSmall.months_to_goal != null && accelLarge.months_to_goal != null) {
      expect(accelLarge.months_to_goal).toBeLessThan(accelSmall.months_to_goal)
    }
  })

  it('no purchases are scheduled before the cash pot can afford a deposit', () => {
    // No loans, no starting cash buffer beyond modest rental surplus → first buy is delayed
    const result = generatePathways({ ...baseGoal }, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1)
    const steady = result.find(p => p.template_name === 'max_cashflow')!
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

  it('more months below the ICR floor increases risk', () => {
    const few = computeRiskScore(makeSummary({ months_below_icr: 1 }))
    const many = computeRiskScore(makeSummary({ months_below_icr: 10 }))
    expect(many).toBeGreaterThan(few)
  })

  it('a thin ICR cushion adds risk; a comfortable one does not', () => {
    const thin = computeRiskScore(makeSummary({ min_icr: 110 }))   // below 145 ⇒ penalty
    const comfy = computeRiskScore(makeSummary({ min_icr: 200 }))  // above 145 ⇒ none
    expect(thin).toBeGreaterThan(comfy)
    expect(comfy).toBe(0)
  })
})

describe('analyzeBinding', () => {
  it('flags an ICR breach as the binding constraint (infeasible)', () => {
    const goal = { goal_type: 'count' as const, min_icr: 125 }
    const months = [makeMonth({ monthly_icr: 110 })]
    const summary = makeSummary({ min_icr: 110 })
    const b = analyzeBinding(goal, months, summary, false, 30000)
    expect(b.key).toBe('icr')
    expect(b.detail).toMatch(/Infeasible/i)
  })

  it('reports deposit capital as the limiter when constraints have ample slack', () => {
    // Generous constraints, healthy LTV/ICR/liquidity, but goal not reached → capital-limited
    const goal = { goal_type: 'count' as const, max_ltv_pct: 95, min_icr: 100 }
    const months = [makeMonth({ total_value: 500000, total_debt: 200000, monthly_icr: 250 })]
    const summary = makeSummary({ min_icr: 250, min_cumulative_cashflow: 80000 })
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

  it('flags a cash-reserve breach as infeasible (P0 #3)', () => {
    // property_count=4, default reserve = 3*200*4 + 1000*4 = £6,400; cash sits at £2,000 — below floor.
    const goal = { goal_type: 'count' as const }
    const months = [makeMonth({ cumulative_cashflow: 2000, property_count: 4 })]
    const summary = makeSummary({ min_cumulative_cashflow: 2000 })
    const b = analyzeBinding(goal, months, summary, false, 30000, 200)
    expect(b.key).toBe('reserve')
    expect(b.detail).toMatch(/Infeasible/i)
  })

  it('a larger configured reserve requirement narrows headroom (still backward-compatible signature)', () => {
    const monthsAt = (cash: number) => [makeMonth({ cumulative_cashflow: cash, property_count: 4 })]
    const summary = makeSummary({ min_cumulative_cashflow: 6500 })
    const small = analyzeBinding({ goal_type: 'count' as const, min_cash_reserve_months: 1 }, monthsAt(6500), summary, true, 30000, 200)
    const large = analyzeBinding({ goal_type: 'count' as const, min_cash_reserve_months: 12 }, monthsAt(6500), summary, true, 30000, 200)
    expect(small.detail).not.toMatch(/Infeasible/i)
    expect(large.detail).toMatch(/Infeasible/i)
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

describe('generatePathways — configurable cash reserve (P0 #3)', () => {
  const goal = { goal_type: 'count' as const, target_property_count: 6, director_loan_annual: 200000 }

  it('no strategy ever lets post-tax cash dip below its portfolio-sized reserve floor', () => {
    const reserveFloorOf = (months: number, capex: number, propertyCount: number) =>
      months * ASSUMPTIONS.monthly_expenses * Math.max(1, propertyCount) + capex * propertyCount

    for (const p of generatePathways(goal, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1)) {
      for (const m of p.results.months) {
        const floor = reserveFloorOf(3, 1000, m.property_count)   // defaults: 3mo, £1,000/property
        expect(m.cumulative_cashflow_posttax).toBeGreaterThanOrEqual(floor - 1)  // -1 to tolerate rounding
      }
    }
  })

  it('a larger configured reserve requirement delays the first purchase', () => {
    const lean = generatePathways({ ...goal, min_cash_reserve_months: 1 }, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1)
    const cautious = generatePathways({ ...goal, min_cash_reserve_months: 12 }, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1)
    const firstBuyOf = (ps: ReturnType<typeof generatePathways>) =>
      firstBuyDate(ps.find(p => p.template_name === 'target_hold')!.events)
    const leanFirst = firstBuyOf(lean)
    const cautiousFirst = firstBuyOf(cautious)
    expect(leanFirst).toBeDefined()
    if (cautiousFirst) {
      expect(cautiousFirst >= leanFirst!).toBe(true)
    }
  })

  it('the Mortgage Recycler now respects the reserve too (previously zero-buffer)', () => {
    const ps = generatePathways(goal, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1)
    const recycler = ps.find(p => p.template_name === 'mortgage_recycler')!
    for (const m of recycler.results.months) {
      const cashAvail = m.cumulative_cashflow_posttax
      const floor = 3 * ASSUMPTIONS.monthly_expenses * Math.max(1, m.property_count) + 1000 * m.property_count
      expect(cashAvail).toBeGreaterThanOrEqual(floor - 1)
    }
  })
})

describe('generatePathways — configurable starting cash & rate repricing (UI/DB exposure)', () => {
  const goal = { goal_type: 'count' as const, target_property_count: 6, director_loan_annual: 200000 }

  it('an explicit starting_cash overrides the smart reserve-based default', () => {
    const low = generatePathways({ ...goal, starting_cash: 500 }, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1)
    const high = generatePathways({ ...goal, starting_cash: 500000 }, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1)
    const month0Of = (ps: ReturnType<typeof generatePathways>) =>
      ps.find(p => p.template_name === 'target_hold')!.results.months[0].cumulative_cashflow_posttax
    expect(month0Of(high)).toBeGreaterThan(month0Of(low))
  })

  it('a custom mortgage_reprice_years/uplift reaches the engine via assumptions_json', () => {
    // Fast, aggressive repricing (every 1 year, +5%) should erode cashflow much faster
    // than the engine defaults (5 years, +2%) once financed properties are in the book.
    const fastReprice = generatePathways(
      { ...goal, mortgage_reprice_years: 1, mortgage_reprice_uplift_bps: 500 },
      startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1
    )
    const defaultReprice = generatePathways(goal, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1)
    const endCfOf = (ps: ReturnType<typeof generatePathways>) => {
      const m = ps.find(p => p.template_name === 'target_hold')!.results.months
      return m[m.length - 1].monthly_cashflow_posttax
    }
    expect(endCfOf(fastReprice)).toBeLessThan(endCfOf(defaultReprice))
  })

  it('every generated pathway carries the assumptions_json it was actually run with', () => {
    const ps = generatePathways(
      { ...goal, mortgage_reprice_years: 3, mortgage_reprice_uplift_bps: 300 },
      startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1
    )
    for (const p of ps) {
      const a = JSON.parse(p.assumptions_json)
      expect(a.mortgage_reprice_years).toBe(3)
      expect(a.mortgage_reprice_uplift_bps).toBe(300)
    }
  })
})

describe('generatePathways — lender ICR buy gate (P0 #4)', () => {
  const goal = { goal_type: 'count' as const, target_property_count: 6, director_loan_annual: 200000 }

  it('a deal that fails lender ICR is never bought, regardless of available cash', () => {
    // price 200k / rent 500 -> stressed ICR ~53%, far below the 125% default floor.
    const unfinanceable = { purchase_price: 200000, monthly_rent: 500, monthly_expenses: 200, deposit_percent: 25, mortgage_rate: 5.5, mortgage_term_years: 25 }
    const ps = generatePathways(goal, startingPortfolio(), unfinanceable, PROJECTION_YEARS, 1)
    for (const p of ps) {
      expect(buyCount(p.events)).toBe(0)
    }
  })

  it('an otherwise-identical, healthy deal is bought', () => {
    const ps = generatePathways(goal, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1)
    const hold = ps.find(p => p.template_name === 'target_hold')!
    expect(buyCount(hold.events)).toBeGreaterThan(0)
  })

  it('a stricter goal.min_icr can reject a deal that would otherwise pass', () => {
    // ASSUMPTIONS clears the 125% default (~171%) but not a strict 200% override.
    const strict = { ...goal, min_icr: 200 }
    const ps = generatePathways(strict, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1)
    for (const p of ps) {
      expect(buyCount(p.events)).toBe(0)
    }
  })
})
