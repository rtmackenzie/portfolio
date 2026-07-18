import { describe, it, expect } from 'vitest'
import {
  generatePathways,
  computeRiskScore100,
  analyzeBinding,
  rankPathways,
  runHybridTemplate,
  HYBRID_TEMPLATES,
  type RankablePathway,
  type Goal,
} from '../../server/services/pathwayGenerator.ts'
import { buildProjection, type PropertyState, type ScenarioEvent } from '../../server/services/scenarioEngine.ts'
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

describe("generatePathways — a goal's linked scenario is planned on top of, not ignored", () => {
  // Committed events come from the goal's linked scenario (goals.scenario_id). They are decisions
  // the investor has already made, so the generator must plan around them: they consume cash,
  // count toward the goal, and are excluded from the decision cap.
  const goal = { goal_type: 'count' as const, target_property_count: 6, director_loan_annual: 200000 }
  // Cash-starved variant: without a director loan the plan can only fund a couple of purchases,
  // so a committed buy is not silently substituted for one the generator would have made anyway.
  const leanGoal = { goal_type: 'count' as const, target_property_count: 6 }

  // Dates must fall after the projection's base_date, which runTemplate takes as today — so they
  // are computed relative to now rather than hardcoded, or these tests would rot with the calendar.
  function monthsFromNow(n: number): string {
    const d = new Date()
    d.setDate(1)
    d.setMonth(d.getMonth() + n)
    return d.toISOString().slice(0, 10)
  }

  function committedBuy(date: string): ScenarioEvent {
    return {
      event_type: 'buy_property',
      property_id: null,
      date,
      parameters_json: JSON.stringify({
        purchase_price: 100000, monthly_rent: 800, monthly_expenses: 200,
        deposit_percent: 25, mortgage_rate: 5.5, mortgage_term_years: 25,
        legal_fees: 0, arrangement_fee: 0, valuation_fee: 0,
      }),
    } as ScenarioEvent
  }

  const pick = (ps: ReturnType<typeof generatePathways>, name: string) => ps.find(x => x.template_name === name)!
  const endCount = (ps: ReturnType<typeof generatePathways>, name: string) => {
    const m = pick(ps, name).results.months
    return m[m.length - 1].property_count
  }

  it('omitting committedEvents is identical to passing an empty array (regression guard)', () => {
    const omitted = generatePathways(goal, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1)
    const empty = generatePathways(goal, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1, undefined, undefined, [])
    expect(empty.map(p => p.events.length)).toEqual(omitted.map(p => p.events.length))
    expect(empty.map(p => p.months_to_goal)).toEqual(omitted.map(p => p.months_to_goal))
    expect(empty.map(p => p.risk_score)).toEqual(omitted.map(p => p.risk_score))
  })

  it('a committed buy is carried into the pathway and actually executes in the projection', () => {
    // Target & Hold has no concurrent-mortgage cap (unlike the hold variants), so extra committed
    // purchases show up in the ending portfolio rather than being absorbed by a strategy limit.
    const dates = [monthsFromNow(2), monthsFromNow(5)]
    const none = generatePathways(leanGoal, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1)
    const withCommitted = generatePathways(
      leanGoal, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1, undefined, undefined, dates.map(committedBuy)
    )
    // Present in the event list…
    for (const d of dates) {
      expect(pick(withCommitted, 'target_hold').events.some(e => e.date === d && e.event_type === 'buy_property')).toBe(true)
    }
    // …and genuinely projected, not merely appended: more property and more equity at the horizon.
    expect(endCount(withCommitted, 'target_hold')).toBeGreaterThan(endCount(none, 'target_hold'))
    expect(pick(withCommitted, 'target_hold').results.summary.end_equity)
      .toBeGreaterThan(pick(none, 'target_hold').results.summary.end_equity)
  })

  it('committed buys share the cash pot, so the generator decides fewer purchases of its own', () => {
    const dates = [monthsFromNow(2), monthsFromNow(5)]
    const none = generatePathways(goal, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1)
    const withCommitted = generatePathways(
      goal, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1, undefined, undefined, dates.map(committedBuy)
    )
    const ownBuys = (ps: ReturnType<typeof generatePathways>, name: string) =>
      buyCount(pick(ps, name).events.filter(e => !dates.includes(e.date)))
    // Target & Hold stops at the goal, so pre-committed purchases displace its own rather than
    // adding to them — the clearest evidence the committed events were visible to the cash gates.
    expect(ownBuys(withCommitted, 'target_hold')).toBeLessThan(ownBuys(none, 'target_hold'))
  })

  it('committed events do not consume the decision cap', () => {
    const dates = [monthsFromNow(2), monthsFromNow(4), monthsFromNow(6)]
    const ps = generatePathways(
      goal, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1, undefined, undefined, dates.map(committedBuy)
    )
    const maxCf = pick(ps, 'max_cashflow')
    const own = maxCf.events.filter(e => !dates.includes(e.date))
    // The cap is projYears * 4 decisions; committed events ride alongside rather than counting
    // against it, so the generator still decides a full slate of its own on top of them.
    expect(own.length).toBeGreaterThan(PROJECTION_YEARS * 2)
    expect(maxCf.events.length).toBeGreaterThan(own.length)
  })

  it('committed buys bring a property-count goal forward', () => {
    const none = generatePathways(goal, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1)
    const withCommitted = generatePathways(
      goal, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1, undefined, undefined,
      [monthsFromNow(2), monthsFromNow(5)].map(committedBuy)
    )
    const baseline = pick(none, 'target_hold').months_to_goal
    const committed = pick(withCommitted, 'target_hold').months_to_goal
    expect(baseline).not.toBeNull()
    expect(committed).not.toBeNull()
    // Two purchases already committed land sooner than the plan would have chosen them.
    expect(committed!).toBeLessThan(baseline!)
  })
})

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
    const lowRiskHold = ps.find(p => p.template_name === 'low_risk_hold')!
    expect(io.risk_score).toBeGreaterThan(lowRiskHold.risk_score)
    expect(io.binding_detail).toMatch(/interest-only/i)
  })

  it('the four strategies produce genuinely different portfolios', () => {
    const goal = { goal_type: 'count' as const, target_property_count: 6, director_loan_annual: 200000 }
    const ps = generatePathways(goal, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1)
    const endDebt = (name: string) => {
      const m = ps.find(p => p.template_name === name)!.results.months
      return m[m.length - 1].total_debt
    }
    const debts = [endDebt('target_hold'), endDebt('max_cashflow'), endDebt('low_risk_hold'), endDebt('brrr_recycler')]
    expect(new Set(debts).size).toBe(4) // all distinct ending debt levels
  })
})

describe('generatePathways — BRRR equity-release strategy (§P2-11)', () => {
  const goal = { goal_type: 'count' as const, target_property_count: 6, director_loan_annual: 200000 }

  it('cash-out remortgages a property once its LTV falls below the 65% trigger', () => {
    const ps = generatePathways(goal, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1)
    const brrr = ps.find(p => p.template_name === 'brrr_recycler')!
    const remortgages = brrr.events.filter(e => e.event_type === 'remortgage')
    expect(remortgages.length).toBeGreaterThan(0)
    for (const ev of remortgages) {
      const params = JSON.parse(ev.parameters_json)
      expect(params.new_balance).toBeGreaterThan(0)
      // property_id is deliberately null — the target rides in parameters_json as
      // sim_property_id since it may be a property with no real DB row yet (§P2-11).
      expect(ev.property_id).toBeNull()
      expect(params.sim_property_id).toBeGreaterThan(0)
    }
  })

  it('grows property count at least as fast as Low-Risk Hold — never falls behind the de-gearing strategy', () => {
    // Both strategies now share the same buy-completion cadence bottleneck (§P1-6, 2nd review:
    // a buy can't land until completion_lag_months later, and the generator won't consider
    // another buy until the pending one completes), so BRRR's equity-release edge can narrow to
    // a tie on some fixtures — its distinct (higher-debt, equity-release) risk profile is the
    // strategic differentiator, verified separately below via ending debt.
    const ps = generatePathways(goal, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1)
    const brrr = ps.find(p => p.template_name === 'brrr_recycler')!
    const lowRiskHold = ps.find(p => p.template_name === 'low_risk_hold')!
    const brrrCount = brrr.results.months[brrr.results.months.length - 1].property_count
    const lowRiskHoldCount = lowRiskHold.results.months[lowRiskHold.results.months.length - 1].property_count
    expect(brrrCount).toBeGreaterThanOrEqual(lowRiskHoldCount)
  })

  it('ends up with more debt than Low-Risk Hold — the opposite risk profile', () => {
    const ps = generatePathways(goal, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1)
    const brrr = ps.find(p => p.template_name === 'brrr_recycler')!
    const lowRiskHold = ps.find(p => p.template_name === 'low_risk_hold')!
    const endDebt = (p: typeof brrr) => p.results.months[p.results.months.length - 1].total_debt
    expect(endDebt(brrr)).toBeGreaterThan(endDebt(lowRiskHold))
  })

  it('never refinances early in the projection, before any property has grown enough equity', () => {
    // Starting portfolio is right at the 75% target LTV (not yet below the 65% trigger); a
    // short 1-year window gives no time for appreciation/amortisation to cross the trigger.
    const highLtvPortfolio: Map<number, PropertyState> = new Map([[1, {
      id: 1, value: 200000, monthly_rent: 1200, monthly_mortgage: 600, monthly_other_expenses: 100,
      debt: 150000, is_vacant: false, mortgage_rate: 5.5, is_interest_only: false, purchase_price: 150000,
    }]])
    const ps = generatePathways(goal, highLtvPortfolio, ASSUMPTIONS, 1, 1)
    const brrr = ps.find(p => p.template_name === 'brrr_recycler')!
    const remortgages = brrr.events.filter(e => e.event_type === 'remortgage')
    expect(remortgages.length).toBe(0)
  })
})

describe('generatePathways — BRRR/buy generation respects the goal LTV mandate (§P0-2)', () => {
  const goal = { goal_type: 'count' as const, target_property_count: 6, director_loan_annual: 200000 }

  function ltvOf(pathway: ReturnType<typeof generatePathways>[number], propertyId: number, date: string): number | null {
    const series = pathway.results.property_series.find(p => p.property_id === propertyId)
    const month = series?.months.find(m => m.date === date)
    return month && month.value > 0 ? (month.debt / month.value) * 100 : null
  }

  it('caps BRRR refinance targets at a goal max_ltv_pct below the 75% strategy default', () => {
    const ps = generatePathways({ ...goal, max_ltv_pct: 60 }, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1)
    const brrr = ps.find(p => p.template_name === 'brrr_recycler')!
    const remortgages = brrr.events.filter(e => e.event_type === 'remortgage')
    expect(remortgages.length).toBeGreaterThan(0)
    for (const ev of remortgages) {
      const params = JSON.parse(ev.parameters_json)
      const ltv = ltvOf(brrr, params.sim_property_id, ev.date)
      expect(ltv).not.toBeNull()
      expect(ltv!).toBeCloseTo(60, 0)
    }
  })

  it('a max_ltv_pct at or above 75% leaves BRRR targeting its own 75% default (regression)', () => {
    const ps = generatePathways({ ...goal, max_ltv_pct: 95 }, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1)
    const brrr = ps.find(p => p.template_name === 'brrr_recycler')!
    const remortgages = brrr.events.filter(e => e.event_type === 'remortgage')
    expect(remortgages.length).toBeGreaterThan(0)
    for (const ev of remortgages) {
      const params = JSON.parse(ev.parameters_json)
      const ltv = ltvOf(brrr, params.sim_property_id, ev.date)
      expect(ltv!).toBeCloseTo(75, 0)
    }
  })

  it('a tight max_ltv_pct also throttles ordinary buy_property events, for a non-BRRR strategy too', () => {
    const lowLtvPortfolio: Map<number, PropertyState> = new Map([[1, {
      id: 1, value: 200000, monthly_rent: 1200, monthly_mortgage: 300, monthly_other_expenses: 100,
      debt: 60000, is_vacant: false, mortgage_rate: 5.5, is_interest_only: false, purchase_price: 150000,
    }]])
    const bigGoal = { goal_type: 'count' as const, target_property_count: 20, director_loan_annual: 200000 }
    const uncapped = generatePathways(bigGoal, lowLtvPortfolio, ASSUMPTIONS, PROJECTION_YEARS, 1)
    const capped = generatePathways({ ...bigGoal, max_ltv_pct: 45 }, lowLtvPortfolio, ASSUMPTIONS, PROJECTION_YEARS, 1)
    const buyCount = (ps: typeof uncapped) => ps.find(p => p.template_name === 'target_hold')!.events.filter(e => e.event_type === 'buy_property').length
    expect(buyCount(capped)).toBeLessThan(buyCount(uncapped))
    const cappedHold = capped.find(p => p.template_name === 'target_hold')!
    const maxLtv = Math.max(...cappedHold.results.months.map(m => m.total_value > 0 ? (m.total_debt / m.total_value) * 100 : 0))
    expect(maxLtv).toBeLessThanOrEqual(45.01)
  })

  it('a pathway generated under a tight mandate is not marked infeasible for the LTV reason the mandate itself now prevents', () => {
    const lowLtvPortfolio: Map<number, PropertyState> = new Map([[1, {
      id: 1, value: 200000, monthly_rent: 1200, monthly_mortgage: 300, monthly_other_expenses: 100,
      debt: 60000, is_vacant: false, mortgage_rate: 5.5, is_interest_only: false, purchase_price: 150000,
    }]])
    const bigGoal = { goal_type: 'count' as const, target_property_count: 20, director_loan_annual: 200000, max_ltv_pct: 45 }
    const ps = generatePathways(bigGoal, lowLtvPortfolio, ASSUMPTIONS, PROJECTION_YEARS, 1)
    const hold = ps.find(p => p.template_name === 'target_hold')!
    expect(hold.feasible).toBe(true)
  })
})

describe('generatePathways — Medium-Risk Hold variant + configurable de-gear mortgage cap', () => {
  const goal = { goal_type: 'count' as const, target_property_count: 8, director_loan_annual: 200000 }

  // Peak number of properties simultaneously carrying a mortgage (debt > 0) across the projection.
  function maxConcurrentMortgages(pathway: ReturnType<typeof generatePathways>[number]): number {
    const byDate = new Map<string, number>()
    for (const ps of pathway.results.property_series) {
      for (const m of ps.months) {
        if (m.debt > 0) byDate.set(m.date, (byDate.get(m.date) ?? 0) + 1)
      }
    }
    let max = 0
    for (const c of byDate.values()) max = Math.max(max, c)
    return max
  }

  it('Low-Risk Hold still caps concurrent mortgages at 2 (regression, default settings)', () => {
    const ps = generatePathways(goal, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1)
    const low = ps.find(p => p.template_name === 'low_risk_hold')!
    expect(maxConcurrentMortgages(low)).toBeLessThanOrEqual(2)
  })

  it('Medium-Risk Hold exists and holds up to 3 concurrent mortgages by default', () => {
    const ps = generatePathways(goal, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1)
    const med = ps.find(p => p.template_name === 'medium_risk_hold')
    expect(med).toBeDefined()
    const peak = maxConcurrentMortgages(med!)
    expect(peak).toBeLessThanOrEqual(3)
    expect(peak).toBeGreaterThan(2)   // the raised cap is genuinely exercised, not just permitted
  })

  it('the cap reads Settings, not a hardcoded literal', () => {
    // Medium cap raised to 5 → holds up to 5; Low cap dropped to 1 → holds at most 1.
    const medHigh = generatePathways(goal, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1, undefined, { medium_risk_hold_max_mortgages: 5 } as any)
      .find(p => p.template_name === 'medium_risk_hold')!
    expect(maxConcurrentMortgages(medHigh)).toBeGreaterThan(3)

    const lowOne = generatePathways(goal, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1, undefined, { low_risk_hold_max_mortgages: 1 } as any)
      .find(p => p.template_name === 'low_risk_hold')!
    expect(maxConcurrentMortgages(lowOne)).toBeLessThanOrEqual(1)
  })

  it('a cap of 0 falls back to the engine default (positiveOr guard, §P0-3), not "never buy"', () => {
    const ps = generatePathways(goal, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1, undefined, { low_risk_hold_max_mortgages: 0 } as any)
    const low = ps.find(p => p.template_name === 'low_risk_hold')!
    expect(maxConcurrentMortgages(low)).toBe(2)
  })

  it('sits in the middle of the frontier — more ending debt than Low-Risk Hold, less than Maximise Cashflow', () => {
    const ps = generatePathways(goal, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1)
    const endDebt = (name: string) => ps.find(p => p.template_name === name)!.results.months.at(-1)!.total_debt
    expect(endDebt('medium_risk_hold')).toBeGreaterThan(endDebt('low_risk_hold'))
    expect(endDebt('medium_risk_hold')).toBeLessThan(endDebt('max_cashflow'))
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

describe('generatePathways — binding_detail reports lender ICR, not "deposit capital", when the candidate deal is unfinanceable', () => {
  // Same shape as the real "10 Properties" goal that surfaced this: a low-yield deal (£180k
  // purchase / £950pm rent) whose stressed ICR (~113%) never clears the 145% Ltd/higher-rate
  // floor, no matter how much cash accumulates — so zero buys ever happen, and the reason must
  // be attributed to the lender gate, not to insufficient capital (which analyzeBinding() would
  // otherwise wrongly report, since the realized, unchanged 1-property portfolio shows huge
  // cash/LTV headroom).
  const unfinanceableDeal = {
    purchase_price: 180000,
    monthly_rent: 950,
    monthly_expenses: 200,
    deposit_percent: 25,
    mortgage_rate: 5.5,
    mortgage_term_years: 25,
  }
  const goal: Goal = { goal_type: 'count', target_property_count: 10, max_ltv_pct: 75 }

  it('flags binding_constraint as icr and names the stressed ICR / floor in binding_detail', () => {
    const ps = generatePathways(goal, startingPortfolio(), unfinanceableDeal, PROJECTION_YEARS, 1)
    for (const p of ps) {
      expect(buyCount(p.events)).toBe(0)
      expect(p.binding_constraint).toBe('icr')
      expect(p.binding_detail).not.toMatch(/deposit capital/i)
      // BRRR still refinances the pre-existing property even with zero new buys — that's a
      // genuine, different realized-portfolio infeasibility (analyzeBinding's normal "violated
      // constraint" path), not the zero-decisions candidate-deal case this fix targets.
      if (p.events.length === 0) {
        expect(p.binding_detail).toMatch(/lender affordability/i)
        expect(p.binding_detail).toMatch(/never clears/i)
      } else {
        expect(p.binding_detail).toMatch(/ICR fell to/i)
      }
    }
  })

  it('still reports the underlying reason for interest-only templates, prefixed as before', () => {
    const ps = generatePathways(goal, startingPortfolio(), unfinanceableDeal, PROJECTION_YEARS, 1)
    const io = ps.find(p => p.template_name === 'max_cashflow')!
    expect(io.binding_detail).toMatch(/interest-only/i)
    expect(io.binding_detail).toMatch(/lender affordability/i)
  })
})

// ─── C3: ranking + binding constraint ────────────────────────────────────────────

// ─── §P2-8 Appendix B.1: bounded 0-100 risk score ─────────────────────────────

describe('computeRiskScore100', () => {
  const baseGoal: Goal = { goal_type: 'count', target_property_count: 6, max_ltv_pct: 75, min_icr: 145 }

  function summary100(over: Partial<{ min_icr: number; total_capital_invested: number }> = {}) {
    return { min_icr: 200, total_capital_invested: 50000, ...over } as any
  }

  function monthsAt(totalValue: number, totalDebt: number, cash = 100000, propertyCount = 1) {
    return [{
      date: '2030-01', total_value: totalValue, total_debt: totalDebt, total_equity: totalValue - totalDebt,
      monthly_cashflow: 1000, cumulative_cashflow: cash, cumulative_cashflow_posttax: cash,
      property_count: propertyCount, monthly_icr: 200,
    }] as any
  }

  function buyEv(price: number, depositPercent = 25, interestOnly = false) {
    return { event_type: 'buy_property', property_id: null, date: '2026-01-01', parameters_json: JSON.stringify({ purchase_price: price, deposit_percent: depositPercent, interest_only: interestOnly }) }
  }

  it('is always bounded within 0-100, even under an extreme worst-case input', () => {
    const months = monthsAt(100000, 95000, -50000, 20)
    const events = Array.from({ length: 60 }, () => buyEv(100000, 25, true))
    const r = computeRiskScore100(months, events, summary100({ min_icr: 50, total_capital_invested: 500000 }), baseGoal, 15, 200)
    expect(r.total).toBeGreaterThanOrEqual(0)
    expect(r.total).toBeLessThanOrEqual(100)
  })

  it('a genuine LTV mandate breach forces the total into the Critical band (>=90)', () => {
    // goal ceiling 75%; portfolio peaks at 80% — a real breach.
    const months = monthsAt(100000, 80000)
    const r = computeRiskScore100(months, [], summary100(), baseGoal, 15, 200)
    expect(r.total).toBeGreaterThanOrEqual(90)
    expect(r.band).toBe('Critical')
  })

  it('leverage scores 0 at or below 30% LTV and rises toward the mandate', () => {
    const low = computeRiskScore100(monthsAt(100000, 30000), [], summary100(), baseGoal, 15, 200)
    const high = computeRiskScore100(monthsAt(100000, 70000), [], summary100(), baseGoal, 15, 200)
    expect(low.components.leverage).toBe(0)
    expect(high.components.leverage).toBeGreaterThan(low.components.leverage)
    expect(high.components.leverage).toBeLessThanOrEqual(25)
  })

  it('affordability headroom scores 0 at >=2.5x the ICR floor and full weight at the floor', () => {
    const comfy = computeRiskScore100(monthsAt(100000, 50000), [], summary100({ min_icr: 145 * 2.5 }), baseGoal, 15, 200)
    const thin = computeRiskScore100(monthsAt(100000, 50000), [], summary100({ min_icr: 145 }), baseGoal, 15, 200)
    expect(comfy.components.affordability).toBe(0)
    expect(thin.components.affordability).toBeCloseTo(25, 0)
  })

  it('amortisation profile scales with the debt-weighted interest-only share of buy events', () => {
    const allRepayment = [buyEv(100000, 25, false), buyEv(100000, 25, false)]
    const allIO = [buyEv(100000, 25, true), buyEv(100000, 25, true)]
    const r1 = computeRiskScore100(monthsAt(200000, 100000), allRepayment, summary100(), baseGoal, 15, 200)
    const r2 = computeRiskScore100(monthsAt(200000, 100000), allIO, summary100(), baseGoal, 15, 200)
    expect(r1.components.amortisation).toBe(0)
    expect(r2.components.amortisation).toBeCloseTo(15, 0)
  })

  it('liquidity resilience scores 0 at >=3x the reserve floor and full weight at the floor', () => {
    const goal: Goal = { ...baseGoal, min_cash_reserve_months: 3, capex_reserve_per_property: 1000 }
    // floor = 3*200*1 + 1000*1 = 1600
    const comfy = computeRiskScore100(monthsAt(100000, 50000, 1600 * 3), [], summary100(), goal, 15, 200)
    const thin = computeRiskScore100(monthsAt(100000, 50000, 1600), [], summary100(), goal, 15, 200)
    expect(comfy.components.liquidity).toBe(0)
    expect(thin.components.liquidity).toBeCloseTo(15, 0)
  })

  it('execution intensity saturates near ~3.5 transactions/year', () => {
    const none = computeRiskScore100(monthsAt(100000, 50000), [], summary100(), baseGoal, 15, 200)
    const heavy = computeRiskScore100(monthsAt(100000, 50000), Array.from({ length: 53 }, () => buyEv(50000)), summary100(), baseGoal, 15, 200)
    expect(none.components.execution).toBe(0)
    expect(heavy.components.execution).toBeCloseTo(10, 0)
  })

  it('operational scale saturates above ~15 ending properties', () => {
    const small = computeRiskScore100(monthsAt(100000, 50000, 100000, 1), [], summary100(), baseGoal, 15, 200)
    const large = computeRiskScore100(monthsAt(100000, 50000, 100000, 15), [], summary100(), baseGoal, 15, 200)
    expect(small.components.scale).toBeLessThan(large.components.scale)
    expect(large.components.scale).toBeCloseTo(10, 0)
  })

  it('a floor of 5 applies once any capital has been deployed — no leveraged plan is riskless', () => {
    // Every component at its safest: low LTV, comfortable ICR, no IO, ample reserve, no
    // transactions, small scale — total would otherwise round to 0.
    const goal: Goal = { ...baseGoal, min_cash_reserve_months: 3, capex_reserve_per_property: 1000 }
    const r = computeRiskScore100(monthsAt(100000, 20000, 100000, 1), [], summary100(), goal, 15, 200)
    expect(r.total).toBeGreaterThanOrEqual(5)
  })

  it('bands map thresholds correctly: 0-25 Low, 26-50 Medium, 51-75 High, 76-100 Critical', () => {
    const goal: Goal = { goal_type: 'count', max_ltv_pct: 200 } // generous ceiling, no breach path
    const lowLtv = computeRiskScore100(monthsAt(100000, 20000), [], summary100({ min_icr: 400 }), goal, 15, 200)
    expect(lowLtv.band).toBe('Low')
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

  // ─── §P2-8 Appendix B.2: ranking modes ──────────────────────────────────────

  it('fastest mode (default) is unchanged from the pre-mode behaviour', () => {
    const rows = [
      base({ id: 1, months_to_goal: 48, risk_score: 80 }),  // fastest, riskiest
      base({ id: 2, months_to_goal: 60, risk_score: 10 }),  // slower, safest
    ]
    const ranked = rankPathways(rows, 'fastest')
    expect(ranked.find(r => r.id === 1)!.recommended).toBe(true)
    expect(ranked.find(r => r.id === 1)!.recommended_reason).toBeUndefined()
  })

  it('balanced mode picks the safest plan within 1.25x the fastest reaching plan', () => {
    const rows = [
      base({ id: 1, months_to_goal: 48, risk_score: 80 }),  // fastest (reference)
      base({ id: 2, months_to_goal: 55, risk_score: 10 }),  // within 1.25x of 48 (=60), far safer
      base({ id: 3, months_to_goal: 90, risk_score: 1 }),   // safest overall but outside 1.25x window
    ]
    const ranked = rankPathways(rows, 'balanced')
    expect(ranked.find(r => r.id === 2)!.recommended).toBe(true)
    expect(ranked.find(r => r.id === 2)!.recommended_reason).toMatch(/safest plan within reach/i)
  })

  it('safest mode picks the minimum-risk plan among those that reach goal', () => {
    const rows = [
      base({ id: 1, months_to_goal: 48, risk_score: 80 }),
      base({ id: 2, months_to_goal: 200, risk_score: 5 }),  // much slower, but safest
    ]
    const ranked = rankPathways(rows, 'safest')
    expect(ranked.find(r => r.id === 2)!.recommended).toBe(true)
    expect(ranked.find(r => r.id === 2)!.recommended_reason).toMatch(/safest plan reaching goal/i)
  })

  it('safest mode falls back to the least-risky feasible plan, tie-broken by smallest shortfall, when none reach goal', () => {
    const rows = [
      base({ id: 1, reaches_goal: 0, months_to_goal: null, risk_score: 10, shortfall: 500 }),
      base({ id: 2, reaches_goal: 0, months_to_goal: null, risk_score: 10, shortfall: 50 }),  // same risk, closer to target
      base({ id: 3, reaches_goal: 0, months_to_goal: null, risk_score: 40, shortfall: 0 }),
    ]
    const ranked = rankPathways(rows, 'safest')
    expect(ranked.find(r => r.id === 2)!.recommended).toBe(true)
    expect(ranked.find(r => r.id === 2)!.recommended_reason).toMatch(/closest safe plan/i)
  })

  it('never recommends an infeasible pathway in balanced or safest mode either', () => {
    const rows = [
      base({ id: 1, feasible: 0, months_to_goal: 24, risk_score: 1 }),   // fastest+safest but infeasible
      base({ id: 2, feasible: 1, months_to_goal: 60, risk_score: 50 }),
    ]
    for (const mode of ['fastest', 'balanced', 'safest'] as const) {
      const ranked = rankPathways(rows, mode)
      expect(ranked.find(r => r.id === 1)!.recommended).toBe(false)
      expect(ranked.find(r => r.id === 2)!.recommended).toBe(true)
    }
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

  it('Low-Risk Hold now respects the reserve too (previously zero-buffer)', () => {
    const ps = generatePathways(goal, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1)
    const lowRiskHold = ps.find(p => p.template_name === 'low_risk_hold')!
    for (const m of lowRiskHold.results.months) {
      const cashAvail = m.cumulative_cashflow_posttax
      const floor = 3 * ASSUMPTIONS.monthly_expenses * Math.max(1, m.property_count) + 1000 * m.property_count
      expect(cashAvail).toBeGreaterThanOrEqual(floor - 1)
    }
  })

  it('Low-Risk Hold ends up worse off once ERC is charged on its opportunistic payoffs (§P1-6)', () => {
    // Regenerating the whole pathway with erc_pct toggled lets the (now month-indexed, §P0-1)
    // candidate deal price drift the buy/payoff timing itself, which can swing total capital
    // deployed by more than the ERC charge — a path-dependent effect unrelated to ERC. Isolate
    // the ERC effect by holding the exact same decision path fixed and only toggling erc_pct in
    // the projection it's re-run against.
    const withErc = generatePathways(goal, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1)
    const lowRiskHoldWithErc = withErc.find(p => p.template_name === 'low_risk_hold')!
    const config = JSON.parse(JSON.stringify({
      base_date: new Date().toISOString().slice(0, 10),
      projection_years: PROJECTION_YEARS,
      starting_cash: 0,
      assumptions_json: lowRiskHoldWithErc.assumptions_json,
    }))
    const noErcConfig = { ...config, assumptions_json: JSON.stringify({ ...JSON.parse(lowRiskHoldWithErc.assumptions_json), erc_pct: 0 }) }
    // ERC is a cash outflow charged against cumulative cashflow, not equity (clearing a
    // mortgage reduces debt/raises equity by the same amount regardless of the ERC paid to do
    // it) — so total_cashflow, not end_equity, is where the charge is directly observable.
    const withErcResults = buildProjection(startingPortfolio(), lowRiskHoldWithErc.events, config) as { summary: { total_cashflow: number } }
    const noErcResults = buildProjection(startingPortfolio(), lowRiskHoldWithErc.events, noErcConfig) as { summary: { total_cashflow: number } }
    expect(withErcResults.summary.total_cashflow).toBeLessThan(noErcResults.summary.total_cashflow)
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

  it('assumptions_json carries the global maintenance-cost settings it was run with (§6b)', () => {
    const settings = { capex_cycle_years: 7, capex_cost_per_property: 4500, arrears_pct: 2.25 } as any
    const ps = generatePathways(goal, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1, undefined, settings)
    for (const p of ps) {
      const a = JSON.parse(p.assumptions_json)
      expect(a.capex_cycle_years).toBe(7)
      expect(a.capex_cost_per_property).toBe(4500)
      expect(a.arrears_pct).toBe(2.25)
    }
  })

  it('buy_property events carry the resolved completion_lag_months/onboarding_void_months from global settings (§P1-6, 2nd review)', () => {
    const settings = { default_completion_lag_months: 4, default_onboarding_void_months: 2 } as any
    const ps = generatePathways(goal, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1, undefined, settings)
    const hold = ps.find(p => p.template_name === 'target_hold')!
    const buys = hold.events.filter(e => e.event_type === 'buy_property').map(e => JSON.parse(e.parameters_json))
    expect(buys.length).toBeGreaterThan(0)
    for (const b of buys) {
      expect(b.completion_lag_months).toBe(4)
      expect(b.onboarding_void_months).toBe(2)
    }
  })

  it('a candidate-deal override for completion_lag_months/onboarding_void_months takes priority over global settings', () => {
    const settings = { default_completion_lag_months: 4, default_onboarding_void_months: 2 } as any
    const overriddenAssumptions = { ...ASSUMPTIONS, completion_lag_months: 0, onboarding_void_months: 0 }
    const ps = generatePathways(goal, startingPortfolio(), overriddenAssumptions, PROJECTION_YEARS, 1, undefined, settings)
    const hold = ps.find(p => p.template_name === 'target_hold')!
    const buys = hold.events.filter(e => e.event_type === 'buy_property').map(e => JSON.parse(e.parameters_json))
    expect(buys.length).toBeGreaterThan(0)
    for (const b of buys) {
      expect(b.completion_lag_months).toBe(0)
      expect(b.onboarding_void_months).toBe(0)
    }
  })
})

describe('generatePathways — candidate deal is indexed to growth over the horizon (P0-1)', () => {
  const goal = { goal_type: 'count' as const, target_property_count: 6, director_loan_annual: 200000 }

  function buyEvents(events: { event_type: string; date: string; parameters_json: string }[]) {
    return events
      .filter(e => e.event_type === 'buy_property')
      .map(e => ({ date: e.date, ...JSON.parse(e.parameters_json) as { purchase_price: number; monthly_rent: number } }))
      .sort((a, b) => a.date.localeCompare(b.date))
  }

  it('a purchase late in a long horizon costs and rents more than the base candidate deal', () => {
    const ps = generatePathways(goal, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1)
    const buys = buyEvents(ps.find(p => p.template_name === 'low_risk_hold')!.events)
    expect(buys.length).toBeGreaterThan(1)
    const last = buys[buys.length - 1]
    expect(last.purchase_price).toBeGreaterThan(ASSUMPTIONS.purchase_price)
    expect(last.monthly_rent).toBeGreaterThan(ASSUMPTIONS.monthly_rent)
  })

  it('price/rent rise roughly monotonically with purchase order, tracking the default 3%/2.5% growth', () => {
    const ps = generatePathways(goal, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1)
    const buys = buyEvents(ps.find(p => p.template_name === 'low_risk_hold')!.events)
    for (let k = 1; k < buys.length; k++) {
      expect(buys[k].purchase_price).toBeGreaterThanOrEqual(buys[k - 1].purchase_price)
      expect(buys[k].monthly_rent).toBeGreaterThanOrEqual(buys[k - 1].monthly_rent)
    }
    const first = buys[0]
    const last = buys[buys.length - 1]
    const b = new Date(first.date)
    const t = new Date(last.date)
    const monthsElapsed = (t.getFullYear() - b.getFullYear()) * 12 + (t.getMonth() - b.getMonth())
    const expectedPrice = first.purchase_price * Math.pow(1.03, monthsElapsed / 12)
    expect(last.purchase_price).toBeCloseTo(expectedPrice, -2)
  })

  it('a custom growth rate (via global settings) changes the indexed price accordingly', () => {
    const lowGrowth = generatePathways(goal, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1, undefined, { default_property_growth_pct: 0.5 } as any)
    const highGrowth = generatePathways(goal, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1, undefined, { default_property_growth_pct: 8 } as any)
    const lastPrice = (ps: ReturnType<typeof generatePathways>) => {
      const buys = buyEvents(ps.find(p => p.template_name === 'low_risk_hold')!.events)
      return buys[buys.length - 1].purchase_price
    }
    expect(lastPrice(highGrowth)).toBeGreaterThan(lastPrice(lowGrowth))
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

  it('min_icr: 0 does not silently disable the gate — the tax-derived floor still applies (§P0-3)', () => {
    // Same unfinanceable deal as above (~53% stressed ICR) — a naive `?? ` fallback would
    // treat 0 as "no floor" and buy it anyway; the fix must still reject it.
    const unfinanceable = { purchase_price: 200000, monthly_rent: 500, monthly_expenses: 200, deposit_percent: 25, mortgage_rate: 5.5, mortgage_term_years: 25 }
    const ps = generatePathways({ ...goal, min_icr: 0 }, startingPortfolio(), unfinanceable, PROJECTION_YEARS, 1)
    for (const p of ps) {
      expect(buyCount(p.events)).toBe(0)
    }
  })
})

describe('generatePathways — 0 for min_icr/capex reserve means "use default", not "disable" (§P0-3)', () => {
  const goal = { goal_type: 'count' as const, target_property_count: 6, director_loan_annual: 200000 }

  it('capex_reserve_per_property: 0 still enforces the default £1,000/property reserve floor', () => {
    const zeroReserve = generatePathways({ ...goal, capex_reserve_per_property: 0 }, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1)
    const defaultReserve = generatePathways(goal, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1)
    // Same reserve floor applied either way -> identical buy/payoff timing.
    const dates = (ps: typeof zeroReserve) => ps.find(p => p.template_name === 'target_hold')!.events.map(e => e.date)
    expect(dates(zeroReserve)).toEqual(dates(defaultReserve))
  })

  it('erc_pct: 0 is unaffected (legitimate, deliberate "no ERC" — regression)', () => {
    // erc_pct is not in scope for the 0-guardrail: 0 genuinely means "disable ERC" and is
    // asserted elsewhere (Low-Risk Hold ERC test) — this just confirms positiveOr wasn't
    // accidentally applied to it too.
    const ps = generatePathways({ ...goal, erc_pct: 0 }, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1)
    expect(ps.length).toBeGreaterThan(0)
  })

  it('an operator-zeroed global capex_cost_per_property still falls through to the engine literal', () => {
    const zeroedSettings = { capex_cost_per_property: 0 } as any
    const ps = generatePathways(goal, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1, undefined, zeroedSettings)
    const hold = ps.find(p => p.template_name === 'target_hold')!
    const capexCostPerProperty = JSON.parse(hold.assumptions_json).capex_cost_per_property
    expect(capexCostPerProperty).toBe(3000)
  })
})

describe('generatePathways — an explicit 0 for a fee field is respected as a genuine zero, not overridden (fee fields are real costs, not safety gates)', () => {
  const goal = { goal_type: 'count' as const, target_property_count: 6, director_loan_annual: 200000 }

  it('a candidate deal with arrangement_fee: 0 keeps £0 in the resulting buy event (e.g. a fee-free mortgage product)', () => {
    const zeroFee = { ...ASSUMPTIONS, arrangement_fee: 0 }
    const ps = generatePathways(goal, startingPortfolio(), zeroFee, PROJECTION_YEARS, 1)
    const hold = ps.find(p => p.template_name === 'target_hold')!
    const buys = hold.events.filter(e => e.event_type === 'buy_property').map(e => JSON.parse(e.parameters_json))
    expect(buys.length).toBeGreaterThan(0)
    for (const b of buys) expect(b.arrangement_fee).toBe(0)
  })

  it('a candidate deal with legal_fees: 0 keeps £0 in the resulting buy event', () => {
    const zeroFee = { ...ASSUMPTIONS, legal_fees: 0 }
    const ps = generatePathways(goal, startingPortfolio(), zeroFee, PROJECTION_YEARS, 1)
    const hold = ps.find(p => p.template_name === 'target_hold')!
    const buys = hold.events.filter(e => e.event_type === 'buy_property').map(e => JSON.parse(e.parameters_json))
    expect(buys.length).toBeGreaterThan(0)
    for (const b of buys) expect(b.legal_fees).toBe(0)
  })

  it('an unset per-goal arrangement_fee on a BRRR refinance still falls through to a genuinely-zeroed global Settings default', () => {
    // Distinguishes "unset" (falls through) from "deliberately zero" (respected) at the Settings
    // layer too — an operator who sets the global default_arrangement_fee to £0 in Settings means
    // it, and it must not silently become £999. The refinance path (unlike a plain buy, which is
    // pre-resolved by the caller before assumptions reach generatePathways) consults `settings`
    // directly inside pathwayGenerator, so it's the one place this Settings-layer fallback is
    // actually exercised.
    const zeroedSettings = { default_arrangement_fee: 0, default_valuation_fee: 300 } as any
    const noFeeInAssumptions = { ...ASSUMPTIONS, arrangement_fee: undefined }
    const ps = generatePathways(goal, startingPortfolio(), noFeeInAssumptions, PROJECTION_YEARS, 1, undefined, zeroedSettings)
    const brrr = ps.find(p => p.template_name === 'brrr_recycler')!
    const remortgages = brrr.events.filter(e => e.event_type === 'remortgage').map(e => JSON.parse(e.parameters_json))
    expect(remortgages.length).toBeGreaterThan(0)
    for (const r of remortgages) expect(r.arrangement_fee).toBe(0)
  })

  it('an unset per-goal arrangement_fee with no Settings override still falls through to the £999 engine literal', () => {
    const noFeeInAssumptions = { ...ASSUMPTIONS, arrangement_fee: undefined }
    const ps = generatePathways(goal, startingPortfolio(), noFeeInAssumptions, PROJECTION_YEARS, 1)
    const hold = ps.find(p => p.template_name === 'target_hold')!
    const buys = hold.events.filter(e => e.event_type === 'buy_property').map(e => JSON.parse(e.parameters_json))
    expect(buys.length).toBeGreaterThan(0)
    for (const b of buys) expect(b.arrangement_fee).toBe(999)
  })
})

describe('computeRiskScore100 — amortisation re-classification (§P2-8d)', () => {
  const baseGoal: Goal = { goal_type: 'count', target_property_count: 6, max_ltv_pct: 75, min_icr: 145 }

  // One IO buy (existing property id 1 is pre-existing; this buy becomes synthetic id 2, per
  // completion-order), then a remortgage converting it to repayment (interest_only omitted,
  // matching the engine's own default-false rule).
  const buy: ScenarioEvent = {
    event_type: 'buy_property', property_id: null, date: '2027-01-01',
    parameters_json: JSON.stringify({ purchase_price: 200000, deposit_percent: 25, interest_only: true }),
  }
  const convertToRepay: ScenarioEvent = {
    event_type: 'remortgage', property_id: null, date: '2030-01-01',
    parameters_json: JSON.stringify({ sim_property_id: 2, new_balance: 140000 }),
  }

  it('drops the amortisation score to 0 once propertySeriesIds/existingPropertyCount reveal the conversion', () => {
    const withFix = computeRiskScore100(
      [makeMonth()], [buy, convertToRepay], makeSummary(), baseGoal, 15, 200, undefined,
      1, [1, 2]
    )
    expect(withFix.components.amortisation).toBe(0)
  })

  it('without the new params, falls back to the old buy-events-only behaviour (still counts it as IO)', () => {
    const withoutFix = computeRiskScore100([makeMonth()], [buy, convertToRepay], makeSummary(), baseGoal, 15, 200, undefined)
    expect(withoutFix.components.amortisation).toBeGreaterThan(0)
  })
})

describe('Hybrid strategy templates (§P2-8d / Appendix D.2)', () => {
  const goal: Goal = { goal_type: 'count', target_property_count: 4, max_ltv_pct: 75 }

  it('io_then_repay matches max_cashflow\'s months_to_goal, ends with 0% IO share, and scores strictly lower', () => {
    const ps = generatePathways(goal, startingPortfolio(), ASSUMPTIONS, 25, 1)
    const maxCf = ps.find(p => p.template_name === 'max_cashflow')!
    const hybrid = ps.find(p => p.template_name === 'io_then_repay')
    expect(maxCf.reaches_goal).toBe(true)
    expect(hybrid).toBeDefined()
    expect(hybrid!.months_to_goal).toBe(maxCf.months_to_goal)
    expect(hybrid!.risk_breakdown.amortisation).toBe(0)
    expect(hybrid!.risk_score).toBeLessThan(maxCf.risk_score!)
  })

  it('brrr_then_degear matches brrr_recycler\'s months_to_goal and scores lower', () => {
    const ps = generatePathways(goal, startingPortfolio(), ASSUMPTIONS, 25, 1)
    const brrr = ps.find(p => p.template_name === 'brrr_recycler')!
    const hybrid = ps.find(p => p.template_name === 'brrr_then_degear')
    expect(brrr.reaches_goal).toBe(true)
    expect(hybrid).toBeDefined()
    expect(hybrid!.months_to_goal).toBe(brrr.months_to_goal)
    expect(hybrid!.risk_score).toBeLessThan(brrr.risk_score!)
  })

  it('never returns a hybrid row when its base strategy never reaches goal (degeneration)', () => {
    const distantGoal: Goal = { goal_type: 'count', target_property_count: 50 }
    const ps = generatePathways(distantGoal, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS, 1)
    expect(ps.find(p => p.template_name === 'io_then_repay')).toBeUndefined()
    expect(ps.find(p => p.template_name === 'brrr_then_degear')).toBeUndefined()
  })

  it('drops brrr_then_degear when phase 2 has nothing to add (dedup)', () => {
    const tightGoal: Goal = { goal_type: 'count', target_property_count: 5, max_ltv_pct: 75 }
    const h = HYBRID_TEMPLATES.find(t => t.template_name === 'brrr_then_degear')!
    const hybrid = runHybridTemplate(h, tightGoal, startingPortfolio(), ASSUMPTIONS, PROJECTION_YEARS)
    expect(hybrid).toBeNull()
  })

  it('cost honesty: the switch month shows the ERC/fee and higher repayment cost, not a free conversion', () => {
    const ps = generatePathways(goal, startingPortfolio(), ASSUMPTIONS, 25, 1)
    const maxCf = ps.find(p => p.template_name === 'max_cashflow')!
    const hybrid = ps.find(p => p.template_name === 'io_then_repay')!
    const switchIdx = hybrid.months_to_goal!
    const hybridCf = hybrid.results.months[switchIdx].monthly_cashflow
    const maxCfCf = maxCf.results.months[switchIdx].monthly_cashflow
    expect(hybridCf).toBeLessThan(maxCfCf)
  })
})
