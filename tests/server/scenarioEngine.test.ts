import { describe, it, expect } from 'vitest'
import { buildProjection, type PropertyState, type ScenarioEvent } from '../../server/services/scenarioEngine.ts'
import { calcMonthlyPayment, calcTransactionCosts } from '../../server/services/calculations.ts'

// Helpers
function makeState(overrides: Partial<PropertyState> = {}): PropertyState {
  return {
    id: 1,
    value: 200000,
    monthly_rent: 1000,
    monthly_mortgage: 500,
    monthly_other_expenses: 100,
    debt: 120000,
    is_vacant: false,
    mortgage_rate: 5.5,
    is_interest_only: false,
    ...overrides,
  }
}

function makeMap(...states: PropertyState[]): Map<number, PropertyState> {
  return new Map(states.map(s => [s.id, s]))
}

function makeEvent(overrides: Partial<ScenarioEvent> & { event_type: string }): ScenarioEvent {
  return {
    date: '2026-07-01',
    property_id: null,
    parameters_json: '{}',
    ...overrides,
  }
}

// void=0, inflation=0, rent growth=0 so existing tests aren't affected by growth defaults
const BASE_CONFIG = {
  base_date: '2026-01-01',
  projection_years: 1,
  assumptions_json: JSON.stringify({ void_months_per_year: 0, expense_inflation_pct: 0, rent_growth_pct: 0 }),
}

// ─── Snapshot structure ───────────────────────────────────────────────────────

describe('buildProjection — output structure', () => {
  it('returns one snapshot per month', () => {
    const { months } = buildProjection(makeMap(makeState()), [], { base_date: '2026-01-01', projection_years: 2 })
    expect(months).toHaveLength(24)
  })

  it('snapshot dates are sequential YYYY-MM strings', () => {
    const { months } = buildProjection(makeMap(makeState()), [], BASE_CONFIG)
    expect(months[0].date).toBe('2026-01')
    expect(months[11].date).toBe('2026-12')
  })

  it('summary fields are present', () => {
    const { summary } = buildProjection(makeMap(makeState()), [], BASE_CONFIG)
    expect(summary).toHaveProperty('start_equity')
    expect(summary).toHaveProperty('end_equity')
    expect(summary).toHaveProperty('equity_growth')
    expect(summary).toHaveProperty('equity_growth_pct')
    expect(summary).toHaveProperty('total_cashflow')
    expect(summary).toHaveProperty('avg_monthly_cashflow')
  })

  it('returns empty months and zero summary for empty portfolio', () => {
    const { months, summary } = buildProjection(new Map(), [], BASE_CONFIG)
    expect(months).toHaveLength(12)
    expect(months[0].total_value).toBe(0)
    expect(summary.start_equity).toBe(0)
  })

  it('does not mutate the caller initial state map', () => {
    const original = makeState({ monthly_rent: 1000 })
    const map = makeMap(original)
    buildProjection(map, [
      makeEvent({ event_type: 'rent_change', parameters_json: JSON.stringify({ change_percent: 50 }) }),
    ], BASE_CONFIG)
    expect(map.get(1)!.monthly_rent).toBe(1000) // unchanged
  })
})

// ─── Property growth and debt decay ──────────────────────────────────────────

describe('buildProjection — growth model', () => {
  it('equity grows over a 10-year projection (3% growth + debt decay)', () => {
    const { summary } = buildProjection(
      makeMap(makeState()),
      [],
      { base_date: '2026-01-01', projection_years: 10 }
    )
    expect(summary.end_equity).toBeGreaterThan(summary.start_equity)
    expect(summary.equity_growth).toBeGreaterThan(0)
  })

  it('total_value in month 12 is higher than month 1 (3% annual growth)', () => {
    const { months } = buildProjection(makeMap(makeState()), [], BASE_CONFIG)
    expect(months[11].total_value).toBeGreaterThan(months[0].total_value)
  })

  it('total_debt is constant when payment does not cover interest (no principal reduction)', () => {
    // Default makeState: debt=120000, rate=5.5% → interest=£550/mo > payment=£500/mo
    const { months } = buildProjection(makeMap(makeState()), [], BASE_CONFIG)
    expect(months[11].total_debt).toBe(months[0].total_debt)
  })
})

// ─── Amortisation ─────────────────────────────────────────────────────────────

describe('buildProjection — amortisation', () => {
  it('repayment mortgage: debt falls each month', () => {
    const debt = 60000
    const rate = 6
    const termMonths = 300
    const payment = calcMonthlyPayment(debt, rate, termMonths)
    const state = makeState({ debt, mortgage_rate: rate, monthly_mortgage: payment, is_interest_only: false })
    const { months } = buildProjection(makeMap(state), [], BASE_CONFIG)
    expect(months[11].total_debt).toBeLessThan(months[0].total_debt)
  })

  it('repayment mortgage: balance after 12 months matches amortisation formula', () => {
    const debt = 60000
    const rate = 6
    const termMonths = 300
    const payment = calcMonthlyPayment(debt, rate, termMonths)
    const state = makeState({ debt, mortgage_rate: rate, monthly_mortgage: payment, is_interest_only: false })
    const { months } = buildProjection(makeMap(state), [], BASE_CONFIG)
    // Expected from standard remaining-balance formula
    const r = rate / 100 / 12
    const expected = debt * (Math.pow(1 + r, termMonths) - Math.pow(1 + r, 12)) / (Math.pow(1 + r, termMonths) - 1)
    expect(Math.abs(months[11].total_debt - Math.round(expected))).toBeLessThanOrEqual(1)
  })

  it('interest-only mortgage: debt stays constant', () => {
    const debt = 120000
    const rate = 5.5
    const state = makeState({
      debt,
      mortgage_rate: rate,
      monthly_mortgage: (debt * rate / 100) / 12,
      is_interest_only: true,
    })
    const { months } = buildProjection(makeMap(state), [], BASE_CONFIG)
    expect(months[11].total_debt).toBe(months[0].total_debt)
  })

  it('buy_property with mortgage_term_years uses amortising payment (debt falls after buy)', () => {
    const { months } = buildProjection(
      makeMap(makeState({ debt: 0, monthly_mortgage: 0, mortgage_rate: 0 })),
      [makeEvent({
        event_type: 'buy_property',
        date: '2026-01-01',
        parameters_json: JSON.stringify({ purchase_price: 80000, monthly_rent: 700, deposit_percent: 25, mortgage_rate: 5.5, mortgage_term_years: 25 }),
      })],
      BASE_CONFIG
    )
    // Debt introduced in month 0 should fall by month 11
    expect(months[11].total_debt).toBeLessThan(months[0].total_debt)
  })

  it('payoff_mortgage: total_debt is 0 from payoff month onward', () => {
    const state = makeState({ id: 1 })
    const { months } = buildProjection(
      makeMap(state),
      [makeEvent({ event_type: 'payoff_mortgage', date: '2026-06-01', property_id: 1, parameters_json: '{}' })],
      BASE_CONFIG
    )
    expect(months[5].total_debt).toBe(0)
    expect(months[11].total_debt).toBe(0)
  })
})

// ─── True cash model — deposits & payoffs draw down the cash pot ────────────────

describe('buildProjection — true cash model', () => {
  it('buy_property deducts the deposit (not just costs) at the buy month', () => {
    const price = 120000, depositPct = 25, rate = 5.5, term = 25
    const debt = price * (1 - depositPct / 100)        // 90000
    const deposit = price * (depositPct / 100)         // 30000
    const { total: txCosts } = calcTransactionCosts(price, 2000, 0)
    const monthlyMortgage = calcMonthlyPayment(debt, rate, term * 12)
    const { months } = buildProjection(
      new Map(),
      [makeEvent({
        event_type: 'buy_property',
        date: '2026-01-01',
        parameters_json: JSON.stringify({
          purchase_price: price, monthly_rent: 0, deposit_percent: depositPct,
          monthly_expenses: 0, mortgage_rate: rate, mortgage_term_years: term,
          legal_fees: 2000, refurb_costs: 0,
        }),
      })],
      BASE_CONFIG
    )
    // month 0: rent 0, first mortgage payment, minus capital outflow (deposit + txCosts)
    expect(months[0].cumulative_cashflow).toBe(Math.round(-(deposit + txCosts) - monthlyMortgage))
  })

  it('payoff_mortgage deducts the cleared balance from cumulative cashflow', () => {
    // interest-only so the balance stays £120k until cleared
    const state = makeState({ id: 1, debt: 120000, is_interest_only: true, monthly_rent: 0, monthly_other_expenses: 0 })
    const { months } = buildProjection(
      makeMap(state),
      [makeEvent({ event_type: 'payoff_mortgage', date: '2026-06-01', property_id: 1, parameters_json: '{}' })],
      BASE_CONFIG
    )
    // The £120k capital outflow lands in the payoff month — a clean step down from the prior month
    expect(months[5].cumulative_cashflow - months[4].cumulative_cashflow).toBe(-120000)
  })
})

// ─── Cashflow ─────────────────────────────────────────────────────────────────

describe('buildProjection — cashflow', () => {
  it('monthly_cashflow = rent − mortgage − other expenses', () => {
    const state = makeState({ monthly_rent: 1000, monthly_mortgage: 500, monthly_other_expenses: 100 })
    const { months } = buildProjection(makeMap(state), [], BASE_CONFIG)
    expect(months[0].monthly_cashflow).toBe(400)
  })

  it('cumulative_cashflow accumulates over months', () => {
    const state = makeState({ monthly_rent: 1000, monthly_mortgage: 500, monthly_other_expenses: 100 })
    const { months } = buildProjection(makeMap(state), [], BASE_CONFIG)
    expect(months[11].cumulative_cashflow).toBeGreaterThan(months[0].cumulative_cashflow)
  })

  it('vacant property contributes £0 rent to cashflow', () => {
    const state = makeState({ monthly_rent: 1000, is_vacant: true, monthly_mortgage: 500, monthly_other_expenses: 0 })
    const { months } = buildProjection(makeMap(state), [], BASE_CONFIG)
    expect(months[0].monthly_cashflow).toBe(-500)
  })

  it('avg_monthly_cashflow is mean of all monthly cashflows', () => {
    const state = makeState({ monthly_rent: 1000, monthly_mortgage: 500, monthly_other_expenses: 100 })
    const { months, summary } = buildProjection(makeMap(state), [], BASE_CONFIG)
    const manualAvg = Math.round(months.reduce((s, m) => s + m.monthly_cashflow, 0) / months.length)
    expect(summary.avg_monthly_cashflow).toBe(manualAvg)
  })

  it('ending_monthly_cashflow equals the final month monthly cashflow', () => {
    const state = makeState({ monthly_rent: 1000, monthly_mortgage: 500, monthly_other_expenses: 100 })
    const { months, summary } = buildProjection(makeMap(state), [], BASE_CONFIG)
    expect(summary.ending_monthly_cashflow).toBe(months[months.length - 1].monthly_cashflow)
  })

  it('rent grows over time when rent_growth_pct > 0 (later month rent > month 0)', () => {
    // No mortgage / no expenses / no void → cashflow is pure rent, isolating rent growth
    const state = makeState({ monthly_rent: 1000, monthly_mortgage: 0, monthly_other_expenses: 0 })
    const { months } = buildProjection(makeMap(state), [], {
      base_date: '2026-01-01',
      projection_years: 2,
      assumptions_json: JSON.stringify({ void_months_per_year: 0, expense_inflation_pct: 0, rent_growth_pct: 10 }),
    })
    expect(months[0].monthly_cashflow).toBe(1000)                       // base year, factor 1
    expect(months[12].monthly_cashflow).toBeGreaterThan(months[0].monthly_cashflow)
    expect(months[12].monthly_cashflow).toBe(Math.round(1000 * 1.10))   // +1 year at 10%
  })

  it('rent stays flat when rent_growth_pct = 0', () => {
    const state = makeState({ monthly_rent: 1000, monthly_mortgage: 0, monthly_other_expenses: 0 })
    const { months } = buildProjection(makeMap(state), [], BASE_CONFIG)
    expect(months[11].monthly_cashflow).toBe(months[0].monthly_cashflow)
  })
})

// ─── Events ───────────────────────────────────────────────────────────────────

describe('buildProjection — buy_property event', () => {
  it('increases property_count after the buy month', () => {
    const { months } = buildProjection(
      makeMap(makeState()),
      [makeEvent({
        event_type: 'buy_property',
        date: '2026-07-01',
        parameters_json: JSON.stringify({ purchase_price: 150000, monthly_rent: 800, deposit_percent: 25, mortgage_rate: 5.5 }),
      })],
      BASE_CONFIG
    )
    expect(months[0].property_count).toBe(1) // before buy
    expect(months[6].property_count).toBe(2) // after buy
  })

  it('increases total_value after buy', () => {
    const { months } = buildProjection(
      makeMap(makeState()),
      [makeEvent({
        event_type: 'buy_property',
        date: '2026-02-01',
        parameters_json: JSON.stringify({ purchase_price: 150000, monthly_rent: 800, deposit_percent: 25, mortgage_rate: 5.5 }),
      })],
      BASE_CONFIG
    )
    expect(months[1].total_value).toBeGreaterThan(months[0].total_value)
  })

  it('deducts LBTT+ADS+fees from cumulative cashflow at buy month', () => {
    // £66k cash buy (100% deposit): deposit=£66,000, ADS=£5,280, LBTT=£0, legal=£2,000 → txCosts=£7,280
    // monthly_expenses=0 so cashflow = £700 rent; cumulative = 700 − 7280 − 66000 = −72,580
    const { months } = buildProjection(
      new Map(),
      [makeEvent({
        event_type: 'buy_property',
        date: '2026-01-01',
        parameters_json: JSON.stringify({
          purchase_price: 66000, monthly_rent: 700, deposit_percent: 100,
          monthly_expenses: 0, legal_fees: 2000, refurb_costs: 0,
        }),
      })],
      BASE_CONFIG
    )
    expect(months[0].cumulative_cashflow).toBe(700 - 7280 - 66000)
  })
})

describe('buildProjection — sell_property event', () => {
  it('decreases property_count after sell', () => {
    const state = makeState({ id: 1 })
    const { months } = buildProjection(
      makeMap(state),
      [makeEvent({
        event_type: 'sell_property',
        date: '2026-06-01',
        property_id: 1,
        parameters_json: '{}',
      })],
      BASE_CONFIG
    )
    expect(months[4].property_count).toBe(1)
    expect(months[5].property_count).toBe(0) // sold in month 6 (index 5)
  })
})

describe('buildProjection — rent_change event', () => {
  it('applies percentage rent change to all properties when no property_id', () => {
    const state = makeState({ monthly_rent: 1000, monthly_mortgage: 0, monthly_other_expenses: 0 })
    const { months } = buildProjection(
      makeMap(state),
      [makeEvent({
        event_type: 'rent_change',
        date: '2026-06-01',
        parameters_json: JSON.stringify({ change_percent: 10 }),
      })],
      BASE_CONFIG
    )
    // Before: £1000/mo, after: £1100/mo
    expect(months[4].monthly_cashflow).toBe(1000)   // month 5 (index 4) — before event
    expect(months[5].monthly_cashflow).toBe(1100)   // month 6 (index 5) — after event
  })

  it('applies absolute new_rent override', () => {
    const state = makeState({ id: 1, monthly_rent: 1000, monthly_mortgage: 0, monthly_other_expenses: 0 })
    const { months } = buildProjection(
      makeMap(state),
      [makeEvent({
        event_type: 'rent_change',
        date: '2026-03-01',
        property_id: 1,
        parameters_json: JSON.stringify({ new_rent: 1250 }),
      })],
      BASE_CONFIG
    )
    expect(months[2].monthly_cashflow).toBe(1250)
  })
})

describe('buildProjection — vacancy_period event', () => {
  it('sets is_vacant so rent becomes £0', () => {
    const state = makeState({ id: 1, monthly_rent: 1000, monthly_mortgage: 0, monthly_other_expenses: 0 })
    const { months } = buildProjection(
      makeMap(state),
      [makeEvent({
        event_type: 'vacancy_period',
        date: '2026-04-01',
        property_id: 1,
        parameters_json: '{}',
      })],
      BASE_CONFIG
    )
    expect(months[2].monthly_cashflow).toBe(1000) // before vacancy
    expect(months[3].monthly_cashflow).toBe(0)    // vacant from month 4
  })
})

describe('buildProjection — major_expense event', () => {
  it('deducts lump sum from cumulative cashflow in that month', () => {
    const state = makeState({ monthly_rent: 1000, monthly_mortgage: 0, monthly_other_expenses: 0 })
    const withoutExpense = buildProjection(makeMap(state), [], BASE_CONFIG)
    const withExpense = buildProjection(
      makeMap(state),
      [makeEvent({
        event_type: 'major_expense',
        date: '2026-06-01',
        parameters_json: JSON.stringify({ amount: 5000 }),
      })],
      BASE_CONFIG
    )
    // From month 6 onwards cumulative should be £5000 lower
    expect(withExpense.months[5].cumulative_cashflow)
      .toBe(withoutExpense.months[5].cumulative_cashflow - 5000)
  })
})

describe('buildProjection — interest_rate_change event', () => {
  it('increases monthly_mortgage for all properties', () => {
    const state = makeState({ monthly_rent: 0, monthly_mortgage: 500, monthly_other_expenses: 0 })
    const { months } = buildProjection(
      makeMap(state),
      [makeEvent({
        event_type: 'interest_rate_change',
        date: '2026-06-01',
        parameters_json: JSON.stringify({ change_basis_points: 25 }),
      })],
      BASE_CONFIG
    )
    // 25bps = 0.25% increase to mortgage payment
    expect(months[5].monthly_cashflow).toBeLessThan(months[4].monthly_cashflow)
  })
})

describe('buildProjection — remortgage event', () => {
  it('resets monthly payment from new rate and term', () => {
    // £120k at 5% over 25y → calcMonthlyPayment(120000, 5, 300) ≈ £701/mo
    const state = makeState({ id: 1, monthly_rent: 0, monthly_mortgage: 500, monthly_other_expenses: 0 })
    const { months } = buildProjection(
      makeMap(state),
      [makeEvent({
        event_type: 'remortgage',
        date: '2026-06-01',
        property_id: 1,
        parameters_json: JSON.stringify({ new_rate: 5, new_term_years: 25, new_balance: 120000 }),
      })],
      BASE_CONFIG
    )
    expect(months[4].monthly_cashflow).toBe(-500)
    expect(months[5].monthly_cashflow).toBeLessThan(-690)
    expect(months[5].monthly_cashflow).toBeGreaterThan(-720)
  })

  it('equity release adds cash-out to cumulative cashflow', () => {
    // Debt £100k (via state.debt), refinance to £130k → £30k equity released in month 0
    const state = makeState({ id: 1, debt: 100000, monthly_rent: 0, monthly_mortgage: 500, monthly_other_expenses: 0 })
    const { months } = buildProjection(
      makeMap(state),
      [makeEvent({
        event_type: 'remortgage',
        date: '2026-01-01',
        property_id: 1,
        parameters_json: JSON.stringify({ new_rate: 5, new_term_years: 25, new_balance: 130000 }),
      })],
      BASE_CONFIG
    )
    expect(months[0].cumulative_cashflow).toBeGreaterThan(20000)
  })

  it('arrangement_fee is deducted from cumulative cashflow', () => {
    const state = makeState({ id: 1, monthly_rent: 0, monthly_mortgage: 500, monthly_other_expenses: 0 })
    const noFee = buildProjection(
      makeMap(state),
      [makeEvent({
        event_type: 'remortgage', date: '2026-06-01', property_id: 1,
        parameters_json: JSON.stringify({ new_rate: 5, new_term_years: 25, new_balance: 120000 }),
      })],
      BASE_CONFIG
    )
    const withFee = buildProjection(
      makeMap(state),
      [makeEvent({
        event_type: 'remortgage', date: '2026-06-01', property_id: 1,
        parameters_json: JSON.stringify({ new_rate: 5, new_term_years: 25, new_balance: 120000, arrangement_fee: 1500 }),
      })],
      BASE_CONFIG
    )
    expect(withFee.months[5].cumulative_cashflow).toBe(noFee.months[5].cumulative_cashflow - 1500)
  })

  it('interest-only refinance does not reduce debt', () => {
    const state = makeState({ id: 1, debt: 120000 })
    const { months } = buildProjection(
      makeMap(state),
      [makeEvent({
        event_type: 'remortgage',
        date: '2026-01-01',
        property_id: 1,
        parameters_json: JSON.stringify({ new_rate: 5, new_term_years: 25, new_balance: 120000, interest_only: 1 }),
      })],
      BASE_CONFIG
    )
    expect(months[11].total_debt).toBe(months[0].total_debt)
  })
})

// ─── Director loans ───────────────────────────────────────────────────────────

describe('buildProjection — director_loan_in event', () => {
  it('adds loan amount to cumulative cashflow in that month', () => {
    const state = makeState({ monthly_rent: 1000, monthly_mortgage: 500, monthly_other_expenses: 100 })
    const without = buildProjection(makeMap(state), [], BASE_CONFIG)
    const withLoan = buildProjection(
      makeMap(state),
      [makeEvent({
        event_type: 'director_loan_in',
        date: '2026-06-01',
        parameters_json: JSON.stringify({ amount: 25000 }),
      })],
      BASE_CONFIG
    )
    expect(withLoan.months[5].cumulative_cashflow)
      .toBe(without.months[5].cumulative_cashflow + 25000)
  })
})

describe('buildProjection — director_loan_repay event', () => {
  it('deducts repayment amount from cumulative cashflow in that month', () => {
    const state = makeState({ monthly_rent: 1000, monthly_mortgage: 500, monthly_other_expenses: 100 })
    const without = buildProjection(makeMap(state), [], BASE_CONFIG)
    const withRepay = buildProjection(
      makeMap(state),
      [makeEvent({
        event_type: 'director_loan_repay',
        date: '2026-06-01',
        parameters_json: JSON.stringify({ amount: 10000 }),
      })],
      BASE_CONFIG
    )
    expect(withRepay.months[5].cumulative_cashflow)
      .toBe(without.months[5].cumulative_cashflow - 10000)
  })
})

// ─── Assumptions ─────────────────────────────────────────────────────────────

describe('buildProjection — assumptions', () => {
  it('uses custom growth rate (5%) — value grows faster than 3%', () => {
    const config = { ...BASE_CONFIG, assumptions_json: JSON.stringify({ property_growth_pct: 5 }) }
    const { months } = buildProjection(makeMap(makeState({ value: 100000 })), [], config)
    // 5% p.a. at month 11: 100000 × 1.05^(11/12) ≈ 104,600 — must exceed 3% result
    expect(months[11].total_value).toBeGreaterThan(104000)
  })

  it('default growth (3%) reproduces prior hardcoded behaviour', () => {
    const { months } = buildProjection(makeMap(makeState({ value: 100000 })), [], BASE_CONFIG)
    // 3% p.a. at month 11: 100000 × 1.03^(11/12) ≈ 102,750
    expect(months[11].total_value).toBeGreaterThan(102000)
    expect(months[11].total_value).toBeLessThan(103500)
  })

  it('void_months_per_year reduces monthly cashflow vs zero void', () => {
    const state = makeState({ monthly_rent: 1000, monthly_mortgage: 0, monthly_other_expenses: 0 })
    const noVoid = buildProjection(
      makeMap(state), [],
      { ...BASE_CONFIG, assumptions_json: JSON.stringify({ void_months_per_year: 0 }) }
    )
    const withVoid = buildProjection(
      makeMap(state), [],
      { ...BASE_CONFIG, assumptions_json: JSON.stringify({ void_months_per_year: 2 }) }
    )
    expect(withVoid.months[0].monthly_cashflow).toBeLessThan(noVoid.months[0].monthly_cashflow)
  })

  it('expense_inflation_pct causes expenses to rise over time', () => {
    const state = makeState({ monthly_rent: 0, monthly_mortgage: 0, monthly_other_expenses: 1000 })
    const { months } = buildProjection(
      makeMap(state), [],
      { ...BASE_CONFIG, projection_years: 10, assumptions_json: JSON.stringify({ expense_inflation_pct: 5, void_months_per_year: 0 }) }
    )
    // Month 0: expenses ≈ £1000; month 119 (year 10): ≈ £1000 × 1.05^(119/12) ≈ £1,620
    expect(months[119].monthly_cashflow).toBeLessThan(months[0].monthly_cashflow)
  })
})

// ─── Stress tests: rate shock ────────────────────────────────────────────────

describe('buildProjection — rate_shock_bps', () => {
  it('raises monthly mortgage for an existing property (+200bps → ×1.02)', () => {
    const state = makeState({ monthly_rent: 0, monthly_mortgage: 500, monthly_other_expenses: 0 })
    const { months } = buildProjection(makeMap(state), [], { ...BASE_CONFIG, rate_shock_bps: 200 })
    // 500 × (1 + 200/10000) = 510 → cashflow = −510
    expect(months[0].monthly_cashflow).toBe(-510)
  })

  it('raises mortgage on a property acquired mid-projection (buy_property)', () => {
    const buyEvent = makeEvent({
      event_type: 'buy_property',
      date: '2026-01-01',
      parameters_json: JSON.stringify({ purchase_price: 150000, monthly_rent: 0, deposit_percent: 25, mortgage_rate: 5, mortgage_term_years: 25, monthly_expenses: 0 }),
    })
    const base    = buildProjection(new Map(), [buyEvent], BASE_CONFIG)
    const shocked = buildProjection(new Map(), [buyEvent], { ...BASE_CONFIG, rate_shock_bps: 300 })
    // Higher rate on the acquired mortgage → more negative operating cashflow
    expect(shocked.months[0].monthly_cashflow).toBeLessThan(base.months[0].monthly_cashflow)
  })

  it('zero shock leaves mortgage unchanged', () => {
    const state = makeState({ monthly_rent: 0, monthly_mortgage: 500, monthly_other_expenses: 0 })
    const { months } = buildProjection(makeMap(state), [], { ...BASE_CONFIG, rate_shock_bps: 0 })
    expect(months[0].monthly_cashflow).toBe(-500)
  })
})

// ─── Stress tests: rent shock ────────────────────────────────────────────────

describe('buildProjection — rent_shock_pct', () => {
  it('reduces rent for an existing property (−10% → ×0.9)', () => {
    const state = makeState({ monthly_rent: 1000, monthly_mortgage: 0, monthly_other_expenses: 0 })
    const { months } = buildProjection(makeMap(state), [], { ...BASE_CONFIG, rent_shock_pct: -10 })
    expect(months[0].monthly_cashflow).toBe(900)
  })

  it('reduces rent for a property acquired mid-projection (regression — buy_property)', () => {
    // The bug: rent_shock_pct was applied only to the initial state, leaving acquired rents unshocked.
    const buyEvent = makeEvent({
      event_type: 'buy_property',
      date: '2026-01-01',
      parameters_json: JSON.stringify({ purchase_price: 80000, monthly_rent: 800, deposit_percent: 100, monthly_expenses: 0 }),
    })
    const { months } = buildProjection(new Map(), [buyEvent], { ...BASE_CONFIG, rent_shock_pct: -10 })
    // deposit 100% → no debt/mortgage; rent 800 × 0.9 = 720
    expect(months[0].monthly_cashflow).toBe(720)
  })

  it('rate and rent shocks combine independently', () => {
    const state = makeState({ monthly_rent: 1000, monthly_mortgage: 500, monthly_other_expenses: 0 })
    const { months } = buildProjection(makeMap(state), [], { ...BASE_CONFIG, rate_shock_bps: 200, rent_shock_pct: -10 })
    // rent 1000 × 0.9 = 900; mortgage 500 × 1.02 = 510 → cashflow = 390
    expect(months[0].monthly_cashflow).toBe(390)
  })
})

// ─── DSCR & liquidity ────────────────────────────────────────────────────────

describe('buildProjection — DSCR', () => {
  it('flags every month below the 1.25× threshold', () => {
    // rent 600 / mortgage 500 = 1.2 DSCR < 1.25 for all 12 months
    const state = makeState({ monthly_rent: 600, monthly_mortgage: 500, monthly_other_expenses: 0 })
    const { summary } = buildProjection(makeMap(state), [], BASE_CONFIG)
    expect(summary.min_dscr).toBe(1.2)
    expect(summary.months_below_dscr).toBe(12)
  })

  it('reports no breaches for a well-covered portfolio', () => {
    // rent 1000 / mortgage 500 = 2.0 DSCR ≥ 1.25
    const state = makeState({ monthly_rent: 1000, monthly_mortgage: 500, monthly_other_expenses: 0 })
    const { summary } = buildProjection(makeMap(state), [], BASE_CONFIG)
    expect(summary.min_dscr).toBe(2)
    expect(summary.months_below_dscr).toBe(0)
  })

  it('rent shock can push a healthy portfolio into DSCR breach', () => {
    // rent 650 / mortgage 500 = 1.3 (healthy); −20% rent → 520/500 = 1.04 (breach)
    const state = makeState({ monthly_rent: 650, monthly_mortgage: 500, monthly_other_expenses: 0 })
    const healthy = buildProjection(makeMap(state), [], BASE_CONFIG)
    const shocked = buildProjection(makeMap(state), [], { ...BASE_CONFIG, rent_shock_pct: -20 })
    expect(healthy.summary.months_below_dscr).toBe(0)
    expect(shocked.summary.months_below_dscr).toBe(12)
  })
})

describe('buildProjection — liquidity (min_cumulative_cashflow)', () => {
  it('equals the trough of cumulative cashflow', () => {
    const state = makeState({ monthly_rent: 1000, monthly_mortgage: 500, monthly_other_expenses: 100 })
    const { months, summary } = buildProjection(makeMap(state), [], BASE_CONFIG)
    const trough = Math.min(...months.map(m => m.cumulative_cashflow))
    expect(summary.min_cumulative_cashflow).toBe(trough)
  })

  it('captures a negative cash dip from acquisition costs', () => {
    // A 100% cash buy incurs LBTT/ADS/fees up front → cumulative goes negative before rent recovers
    const { summary } = buildProjection(
      new Map(),
      [makeEvent({
        event_type: 'buy_property',
        date: '2026-01-01',
        parameters_json: JSON.stringify({ purchase_price: 66000, monthly_rent: 700, deposit_percent: 100, monthly_expenses: 0, legal_fees: 2000, refurb_costs: 0 }),
      })],
      BASE_CONFIG
    )
    expect(summary.min_cumulative_cashflow).toBeLessThan(0)
  })
})
