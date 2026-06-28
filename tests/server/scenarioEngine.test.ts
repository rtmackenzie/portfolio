import { describe, it, expect } from 'vitest'
import { buildProjection, type PropertyState, type ScenarioEvent } from '../../server/services/scenarioEngine.ts'
import { calcMonthlyPayment } from '../../server/services/calculations.ts'

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

// void=0 and inflation=0 so existing tests aren't affected by new defaults
const BASE_CONFIG = {
  base_date: '2026-01-01',
  projection_years: 1,
  assumptions_json: JSON.stringify({ void_months_per_year: 0, expense_inflation_pct: 0 }),
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
    // £66k cash buy: ADS=£5,280, LBTT=£0, legal=£2,000 → txCosts=£7,280
    // monthly_expenses=0 so cashflow = £700 rent; cumulative = 700 − 7280 = −6580
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
    expect(months[0].cumulative_cashflow).toBe(700 - 7280)
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
  it('replaces monthly_mortgage with new payment', () => {
    const state = makeState({ id: 1, monthly_rent: 0, monthly_mortgage: 600, monthly_other_expenses: 0 })
    const { months } = buildProjection(
      makeMap(state),
      [makeEvent({
        event_type: 'remortgage',
        date: '2026-06-01',
        property_id: 1,
        parameters_json: JSON.stringify({ new_monthly_payment: 450 }),
      })],
      BASE_CONFIG
    )
    expect(months[4].monthly_cashflow).toBe(-600)
    expect(months[5].monthly_cashflow).toBe(-450)
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
