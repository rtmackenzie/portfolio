import { describe, it, expect } from 'vitest'
import { buildProjection, type PropertyState, type ScenarioEvent } from '../../server/services/scenarioEngine.ts'
import { calcMonthlyPayment, calcTransactionCosts } from '../../server/services/calculations.ts'
import { DEFAULT_TAX_SETTINGS } from '../../server/services/tax.ts'

const TAX_PERSONAL = { ...DEFAULT_TAX_SETTINGS, ownership: 'personal' as const, personal_marginal_rate_pct: 40, s24_credit_rate_pct: 20 }

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
    purchase_price: 180000,
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
  assumptions_json: JSON.stringify({ void_months_per_year: 0, expense_inflation_pct: 0, rent_growth_pct: 0, arrears_pct: 0 }),
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
          legal_fees: 2000, refurb_costs: 0, arrangement_fee: 0, valuation_fee: 0,
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

  it('payoff_mortgage charges ERC when clearing a fixed deal before its fix ends (§P1-6)', () => {
    const state = makeState({
      id: 1, debt: 120000, is_interest_only: true, monthly_rent: 0, monthly_other_expenses: 0,
      is_fixed_rate: true, next_reprice_month: 12,   // month 5 payoff is well before month 12
    })
    const { months } = buildProjection(
      makeMap(state),
      [makeEvent({ event_type: 'payoff_mortgage', date: '2026-06-01', property_id: 1, parameters_json: '{}' })],
      { ...BASE_CONFIG, assumptions_json: JSON.stringify({ void_months_per_year: 0, expense_inflation_pct: 0, rent_growth_pct: 0, erc_pct: 3 }) }
    )
    // £120k cleared + 3% ERC (£3,600) = £123,600 step down
    expect(months[5].cumulative_cashflow - months[4].cumulative_cashflow).toBe(-123600)
  })

  it('payoff_mortgage charges no ERC once the fix has naturally ended', () => {
    // next_reprice_month === payoff month: the fix has already run its course, so
    // `i < next_reprice_month` is false and no early-exit charge applies.
    const state = makeState({
      id: 1, debt: 120000, is_interest_only: true, monthly_rent: 0, monthly_other_expenses: 0,
      is_fixed_rate: true, next_reprice_month: 5,
    })
    const { months } = buildProjection(
      makeMap(state),
      [makeEvent({ event_type: 'payoff_mortgage', date: '2026-06-01', property_id: 1, parameters_json: '{}' })],
      { ...BASE_CONFIG, assumptions_json: JSON.stringify({ void_months_per_year: 0, expense_inflation_pct: 0, rent_growth_pct: 0, erc_pct: 3 }) }
    )
    expect(months[5].cumulative_cashflow - months[4].cumulative_cashflow).toBe(-120000)
  })

  it('a tracker never incurs ERC on payoff, regardless of timing (regression)', () => {
    const state = makeState({
      id: 1, debt: 120000, is_interest_only: true, monthly_rent: 0, monthly_other_expenses: 0,
      is_fixed_rate: false, next_reprice_month: 12,
    })
    const { months } = buildProjection(
      makeMap(state),
      [makeEvent({ event_type: 'payoff_mortgage', date: '2026-06-01', property_id: 1, parameters_json: '{}' })],
      { ...BASE_CONFIG, assumptions_json: JSON.stringify({ void_months_per_year: 0, expense_inflation_pct: 0, rent_growth_pct: 0, erc_pct: 3 }) }
    )
    expect(months[5].cumulative_cashflow - months[4].cumulative_cashflow).toBe(-120000)
  })
})

// ─── Fixed-rate expiry & repricing (P1 #5 fix) ────────────────────────────────

describe('buildProjection — fixed-rate repricing', () => {
  const NO_GROWTH_ASSUMPTIONS = { void_months_per_year: 0, expense_inflation_pct: 0, rent_growth_pct: 0, property_growth_pct: 0 }

  it('a fixed-rate property reprices exactly at the scheduled month, off the current balance', () => {
    const state = makeState({
      id: 1, debt: 100000, mortgage_rate: 5, monthly_mortgage: calcMonthlyPayment(100000, 5, 300),
      is_fixed_rate: true, mortgage_term_months: 300, next_reprice_month: 12,
      monthly_rent: 0, monthly_other_expenses: 0,
    })
    const { months } = buildProjection(makeMap(state), [], {
      base_date: '2026-01-01', projection_years: 2,
      assumptions_json: JSON.stringify({ ...NO_GROWTH_ASSUMPTIONS, mortgage_reprice_years: 5, mortgage_reprice_uplift_bps: 200 }),
    })
    // Payment unchanged for months 0..11
    expect(months[11].monthly_cashflow).toBe(months[0].monthly_cashflow)
    // At month 12 (index 12), rate rises 5% -> 7% and payment re-amortises off the balance
    // remaining at that point (not the original £100k) over the remaining term.
    const balAtReprice = months[11].total_debt   // balance carried into month 12
    const expectedNewPayment = calcMonthlyPayment(balAtReprice, 7, 300 - 12)
    const preRepriceCashflow = months[0].monthly_cashflow
    const postRepriceCashflow = months[12].monthly_cashflow
    expect(postRepriceCashflow).not.toBe(preRepriceCashflow)
    expect(preRepriceCashflow - postRepriceCashflow).toBe(Math.round(expectedNewPayment) - Math.round(calcMonthlyPayment(100000, 5, 300)))
  })

  it('a tracker (is_fixed_rate false) never reprices — payment stays flat (regression)', () => {
    const state = makeState({
      id: 1, debt: 100000, mortgage_rate: 5, monthly_mortgage: calcMonthlyPayment(100000, 5, 300),
      is_fixed_rate: false, mortgage_term_months: 300, next_reprice_month: 12,
      monthly_rent: 0, monthly_other_expenses: 0,
    })
    const { months } = buildProjection(makeMap(state), [], {
      base_date: '2026-01-01', projection_years: 2,
      assumptions_json: JSON.stringify({ ...NO_GROWTH_ASSUMPTIONS, mortgage_reprice_years: 5, mortgage_reprice_uplift_bps: 200 }),
    })
    expect(months[12].monthly_cashflow).toBe(months[0].monthly_cashflow)
    expect(months[23].monthly_cashflow).toBe(months[0].monthly_cashflow)
  })

  it('a property bought mid-projection reprices from its own acquisition month, not the base date', () => {
    const buy = makeEvent({
      event_type: 'buy_property', date: '2027-01-01', // month 12
      parameters_json: JSON.stringify({ purchase_price: 100000, monthly_rent: 0, deposit_percent: 25, monthly_expenses: 0, mortgage_rate: 5, mortgage_term_years: 25 }),
    })
    const proj = buildProjection(new Map(), [buy], {
      base_date: '2026-01-01', projection_years: 3,
      assumptions_json: JSON.stringify({ ...NO_GROWTH_ASSUMPTIONS, mortgage_reprice_years: 1, mortgage_reprice_uplift_bps: 200 }),
    })
    const ps = proj.property_series.find(s => s.label.startsWith('New Property'))!
    const at = (ym: string) => ps.months.find(m => m.date === ym)!
    // Bought at month 12 (2027-01); reprice 1yr later = month 24 (2028-01), not month 12 (base+1y).
    expect(at('2027-12').monthly_cashflow).toBe(at('2027-01').monthly_cashflow)
    expect(at('2028-01').monthly_cashflow).not.toBe(at('2027-01').monthly_cashflow)
  })

  it('a paid-off mortgage is never repriced', () => {
    const state = makeState({
      id: 1, debt: 100000, mortgage_rate: 5, monthly_mortgage: calcMonthlyPayment(100000, 5, 300),
      is_fixed_rate: true, mortgage_term_months: 300, next_reprice_month: 12,
      monthly_rent: 0, monthly_other_expenses: 0,
    })
    const { months } = buildProjection(
      makeMap(state),
      [makeEvent({ event_type: 'payoff_mortgage', date: '2026-06-01', property_id: 1, parameters_json: '{}' })], // month 5
      { base_date: '2026-01-01', projection_years: 2, assumptions_json: JSON.stringify({ ...NO_GROWTH_ASSUMPTIONS, mortgage_reprice_years: 5, mortgage_reprice_uplift_bps: 200 }) }
    )
    expect(months[12].monthly_cashflow).toBe(0)   // no rent, mortgage cleared -> flat zero, not repriced
    expect(months[23].monthly_cashflow).toBe(0)
  })

  it('repricing recurs on schedule (twice over 15 years at the 5-year default)', () => {
    const state = makeState({
      id: 1, debt: 200000, mortgage_rate: 5, monthly_mortgage: calcMonthlyPayment(200000, 5, 300),
      is_fixed_rate: true, mortgage_term_months: 300, next_reprice_month: 60,
      monthly_rent: 0, monthly_other_expenses: 0,
    })
    const { months } = buildProjection(makeMap(state), [], {
      base_date: '2026-01-01', projection_years: 15,
      assumptions_json: JSON.stringify(NO_GROWTH_ASSUMPTIONS), // reprice_years/uplift default to 5 / 200bps
    })
    const cf0 = months[0].monthly_cashflow
    const cf60 = months[60].monthly_cashflow
    const cf120 = months[120].monthly_cashflow
    expect(cf60).not.toBe(cf0)
    expect(cf120).not.toBe(cf60)
  })
})

// ─── Maintenance costs: lumpy capex + rent arrears (§6b fix) ──────────────────

describe('buildProjection — maintenance costs', () => {
  const NO_GROWTH_ASSUMPTIONS = { void_months_per_year: 0, expense_inflation_pct: 0, rent_growth_pct: 0, property_growth_pct: 0, arrears_pct: 0 }

  it('capex fires at the scheduled cycle for an initial holding and reschedules', () => {
    const state = makeState({ id: 1, debt: 0, mortgage_rate: 0, monthly_mortgage: 0, monthly_rent: 0, monthly_other_expenses: 0 })
    const { months } = buildProjection(makeMap(state), [], {
      base_date: '2026-01-01', projection_years: 21,
      assumptions_json: JSON.stringify({ ...NO_GROWTH_ASSUMPTIONS, capex_cycle_years: 10, capex_cost_per_property: 3000 }),
    })
    // First cycle at month 120 (10y), second at month 240 (20y) — clean £3,000 step-downs
    expect(months[119].cumulative_cashflow - months[120].cumulative_cashflow).toBe(3000)
    expect(months[120].cumulative_cashflow - months[121].cumulative_cashflow).toBe(0)
    expect(months[239].cumulative_cashflow - months[240].cumulative_cashflow).toBe(3000)
  })

  it('a property bought mid-projection has its first capex cycle from its own acquisition month, not the base date', () => {
    const buy = makeEvent({
      event_type: 'buy_property', date: '2027-01-01', // month 12
      parameters_json: JSON.stringify({ purchase_price: 100000, monthly_rent: 0, deposit_percent: 100, monthly_expenses: 0 }),
    })
    const { months } = buildProjection(new Map(), [buy], {
      base_date: '2026-01-01', projection_years: 12,
      assumptions_json: JSON.stringify({ ...NO_GROWTH_ASSUMPTIONS, capex_cycle_years: 10, capex_cost_per_property: 3000 }),
    })
    // Bought at month 12; first capex 10y later = month 132, not month 120 (base+10y).
    expect(months[119].cumulative_cashflow - months[120].cumulative_cashflow).toBe(0)
    expect(months[131].cumulative_cashflow - months[132].cumulative_cashflow).toBe(3000)
  })

  it('capex_cost_per_property: 0 reproduces pre-change output exactly (regression)', () => {
    const state = makeState({ id: 1, debt: 0, mortgage_rate: 0, monthly_mortgage: 0, monthly_rent: 0, monthly_other_expenses: 0 })
    const { months } = buildProjection(makeMap(state), [], {
      base_date: '2026-01-01', projection_years: 11,
      assumptions_json: JSON.stringify({ ...NO_GROWTH_ASSUMPTIONS, capex_cycle_years: 10, capex_cost_per_property: 0 }),
    })
    expect(months[120].cumulative_cashflow).toBe(months[0].cumulative_cashflow)
  })

  it('arrears reduces rent by the expected % alongside void', () => {
    const state = makeState({ id: 1, debt: 0, mortgage_rate: 0, monthly_mortgage: 0, monthly_rent: 1000, monthly_other_expenses: 0, is_vacant: false })
    const { months } = buildProjection(makeMap(state), [], {
      base_date: '2026-01-01', projection_years: 1,
      assumptions_json: JSON.stringify({ void_months_per_year: 0, expense_inflation_pct: 0, rent_growth_pct: 0, property_growth_pct: 0, arrears_pct: 2 }),
    })
    expect(months[0].monthly_cashflow).toBe(980)   // 1000 × (1 - 2%)
  })

  it('a vacant month still shows £0 rent — arrears does not apply on top of a void', () => {
    const state = makeState({ id: 1, debt: 0, mortgage_rate: 0, monthly_mortgage: 0, monthly_rent: 1000, monthly_other_expenses: 0, is_vacant: true })
    const { months } = buildProjection(makeMap(state), [], {
      base_date: '2026-01-01', projection_years: 1,
      assumptions_json: JSON.stringify({ void_months_per_year: 0, expense_inflation_pct: 0, rent_growth_pct: 0, property_growth_pct: 0, arrears_pct: 2 }),
    })
    expect(months[0].monthly_cashflow).toBe(0)
  })

  it('arrears_pct: 0 reproduces pre-change output exactly (regression)', () => {
    const state = makeState({ id: 1, debt: 0, mortgage_rate: 0, monthly_mortgage: 0, monthly_rent: 1000, monthly_other_expenses: 0 })
    const { months } = buildProjection(makeMap(state), [], BASE_CONFIG)
    expect(months[0].monthly_cashflow).toBe(1000)
  })
})

// ─── Acquisition-dated growth (D1 fix) ────────────────────────────────────────

describe('buildProjection — acquisition-dated growth', () => {
  const CFG = {
    base_date: '2026-01-01', projection_years: 3,
    assumptions_json: JSON.stringify({ property_growth_pct: 10, rent_growth_pct: 10, expense_inflation_pct: 0, void_months_per_year: 0, arrears_pct: 0 }),
  }

  it('a mid-projection purchase enters at price/base rent, then grows from its own acquisition month', () => {
    const buy = makeEvent({
      event_type: 'buy_property', date: '2027-01-01', // month 12
      parameters_json: JSON.stringify({ purchase_price: 100000, monthly_rent: 800, deposit_percent: 100, monthly_expenses: 0 }),
    })
    const proj = buildProjection(new Map(), [buy], CFG)
    const ps = proj.property_series.find(s => s.label.startsWith('New Property'))!
    const at = (ym: string) => ps.months.find(m => m.date === ym)!
    // Purchase month: value == price, cashflow (= rent, no mortgage/expense/void) == base 800
    expect(at('2027-01').value).toBe(100000)
    expect(at('2027-01').monthly_cashflow).toBe(800)
    // One year after acquisition: grown ~10% (not from the projection base date)
    expect(at('2028-01').value).toBe(Math.round(100000 * 1.10))
    expect(at('2028-01').monthly_cashflow).toBe(Math.round(800 * 1.10))
  })

  it('an initial holding still grows from the projection base date (regression)', () => {
    const state = makeState({ id: 1, value: 100000, monthly_rent: 800, monthly_mortgage: 0, monthly_other_expenses: 0, debt: 0 })
    const proj = buildProjection(makeMap(state), [], CFG)
    const ps = proj.property_series.find(s => s.property_id === 1)!
    const m12 = ps.months.find(m => m.date === '2027-01')!
    expect(m12.value).toBe(Math.round(100000 * 1.10)) // 12 months from base
  })
})

// ─── Post-tax cashflow (C4) ───────────────────────────────────────────────────

describe('buildProjection — post-tax cashflow', () => {
  it('post-tax equals pre-tax when no tax settings are supplied', () => {
    const state = makeState({ monthly_rent: 1000, monthly_mortgage: 500, monthly_other_expenses: 100 })
    const { months } = buildProjection(makeMap(state), [], BASE_CONFIG)
    expect(months[0].monthly_cashflow_posttax).toBe(months[0].monthly_cashflow)
    expect(months[0].cumulative_cashflow_posttax).toBe(months[0].cumulative_cashflow)
    expect(months[0].monthly_tax).toBe(0)
  })

  it('applies S24 income tax: profit×40% − interest×20%', () => {
    // debt 120k @5.5% → interest = 120000*0.055/12 = 550
    // profit (excl interest) = rent 1000 − expenses 100 = 900
    // tax = 900*0.4 − min(550,900)*0.2 = 360 − 110 = 250
    const state = makeState({ monthly_rent: 1000, monthly_mortgage: 500, monthly_other_expenses: 100, debt: 120000, mortgage_rate: 5.5, is_interest_only: true })
    const { months } = buildProjection(makeMap(state), [], { ...BASE_CONFIG, tax: TAX_PERSONAL })
    expect(months[0].monthly_tax).toBe(250)
    expect(months[0].monthly_cashflow_posttax).toBe(months[0].monthly_cashflow - 250)
    expect(months[0].monthly_cashflow_posttax).toBeLessThan(months[0].monthly_cashflow)
  })

  it('sell_property realises net proceeds to cash; CGT reduces the post-tax line', () => {
    // value 200k, basis 150k, no growth, sell at base month
    const state = makeState({ value: 200000, purchase_price: 150000, debt: 120000, monthly_rent: 0, monthly_mortgage: 0, monthly_other_expenses: 0 })
    const cfg = {
      base_date: '2026-01-01', projection_years: 1,
      assumptions_json: JSON.stringify({ void_months_per_year: 0, expense_inflation_pct: 0, rent_growth_pct: 0, property_growth_pct: 0 }),
      tax: TAX_PERSONAL,
    }
    const { months } = buildProjection(
      makeMap(state),
      [makeEvent({ event_type: 'sell_property', date: '2026-01-01', property_id: 1, parameters_json: '{}' })],
      cfg
    )
    // proceeds: 200k − 2% costs (4k) − 120k debt = 76k realised into cash
    expect(months[0].cumulative_cashflow).toBe(76000)
    expect(months[0].property_count).toBe(0)
    // CGT: (gain 46k − 3k exempt) * 24% = 10,320 → post-tax lower
    expect(months[0].cumulative_cashflow - months[0].cumulative_cashflow_posttax).toBe(10320)
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
      assumptions_json: JSON.stringify({ void_months_per_year: 0, expense_inflation_pct: 0, rent_growth_pct: 10, arrears_pct: 0 }),
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
          arrangement_fee: 0, valuation_fee: 0,
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

  // Compare an erc_pct:3 run against an erc_pct:0 run on the same state/event so the
  // assertion isolates exactly the ERC line item, without hand-deriving amortisation math.
  function remortgageWithErc(state: PropertyState, ercPct: number) {
    const cfg = {
      ...BASE_CONFIG,
      assumptions_json: JSON.stringify({ void_months_per_year: 0, expense_inflation_pct: 0, rent_growth_pct: 0, erc_pct: ercPct }),
    }
    return buildProjection(
      makeMap(state),
      [makeEvent({
        event_type: 'remortgage', date: '2026-06-01', property_id: 1,
        parameters_json: JSON.stringify({ new_rate: 5, new_term_years: 25, new_balance: 100000 }),
      })],
      cfg
    ).months
  }

  it('charges ERC on the pre-remortgage balance when refinancing away from a fixed deal early (§P1-6)', () => {
    const state = makeState({
      id: 1, debt: 100000, monthly_rent: 0, monthly_mortgage: 500, monthly_other_expenses: 0,
      is_fixed_rate: true, next_reprice_month: 12,   // month 5 remortgage is before the fix ends
    })
    const withErc = remortgageWithErc(state, 3)
    const noErc = remortgageWithErc(state, 0)
    // 3% ERC on the £100k balance being replaced (small tolerance for per-month rounding drift)
    expect(Math.abs((noErc[5].cumulative_cashflow - withErc[5].cumulative_cashflow) - 3000)).toBeLessThanOrEqual(10)
  })

  it('charges no ERC on remortgage once the fix has naturally ended', () => {
    const state = makeState({
      id: 1, debt: 100000, monthly_rent: 0, monthly_mortgage: 500, monthly_other_expenses: 0,
      is_fixed_rate: true, next_reprice_month: 5,   // reprice coincides with the remortgage month
    })
    const withErc = remortgageWithErc(state, 3)
    const noErc = remortgageWithErc(state, 0)
    expect(withErc[5].cumulative_cashflow).toBe(noErc[5].cumulative_cashflow)
  })

  it('a tracker never incurs ERC on remortgage, regardless of timing (regression)', () => {
    const state = makeState({
      id: 1, debt: 100000, monthly_rent: 0, monthly_mortgage: 500, monthly_other_expenses: 0,
      is_fixed_rate: false, next_reprice_month: 12,
    })
    const withErc = remortgageWithErc(state, 3)
    const noErc = remortgageWithErc(state, 0)
    expect(withErc[5].cumulative_cashflow).toBe(noErc[5].cumulative_cashflow)
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

// ─── Cover ratio & liquidity ──────────────────────────────────────────────────

describe('buildProjection — cover ratio', () => {
  it('flags every month below the 1.25× threshold', () => {
    // rent 600 / mortgage 500 = 1.2 cover < 1.25 for all 12 months
    const state = makeState({ monthly_rent: 600, monthly_mortgage: 500, monthly_other_expenses: 0 })
    const { summary } = buildProjection(makeMap(state), [], BASE_CONFIG)
    expect(summary.min_cover_ratio).toBe(1.2)
    expect(summary.months_below_cover).toBe(12)
  })

  it('reports no breaches for a well-covered portfolio', () => {
    // rent 1000 / mortgage 500 = 2.0 cover ≥ 1.25
    const state = makeState({ monthly_rent: 1000, monthly_mortgage: 500, monthly_other_expenses: 0 })
    const { summary } = buildProjection(makeMap(state), [], BASE_CONFIG)
    expect(summary.min_cover_ratio).toBe(2)
    expect(summary.months_below_cover).toBe(0)
  })

  it('rent shock can push a healthy portfolio into cover-ratio breach', () => {
    // rent 650 / mortgage 500 = 1.3 (healthy); −20% rent → 520/500 = 1.04 (breach)
    const state = makeState({ monthly_rent: 650, monthly_mortgage: 500, monthly_other_expenses: 0 })
    const healthy = buildProjection(makeMap(state), [], BASE_CONFIG)
    const shocked = buildProjection(makeMap(state), [], { ...BASE_CONFIG, rent_shock_pct: -20 })
    expect(healthy.summary.months_below_cover).toBe(0)
    expect(shocked.summary.months_below_cover).toBe(12)
  })
})

// ─── Lender ICR stress test (P0 #4) ───────────────────────────────────────────

describe('buildProjection — lender ICR', () => {
  it('a low-rate mortgage is stressed to the 5.5% floor, not pay-rate+2%', () => {
    // rate 3% -> pay-rate+2% = 5%, below the 5.5% floor, so 5.5% is used.
    const state = makeState({ debt: 120000, mortgage_rate: 3, monthly_rent: 1000, monthly_mortgage: 500, monthly_other_expenses: 0 })
    const { months } = buildProjection(makeMap(state), [], BASE_CONFIG)
    const expectedIcr = Math.round((1000 / (120000 * 5.5 / 100 / 12)) * 10000) / 100
    expect(months[0].monthly_icr).toBeCloseTo(expectedIcr, 1)
  })

  it('a higher-rate mortgage stresses at pay-rate+2%, above the floor', () => {
    // rate 6% -> pay-rate+2% = 8%, above the 5.5% floor, so 8% is used.
    const state = makeState({ debt: 120000, mortgage_rate: 6, monthly_rent: 1000, monthly_mortgage: 500, monthly_other_expenses: 0 })
    const { months } = buildProjection(makeMap(state), [], BASE_CONFIG)
    const expectedIcr = Math.round((1000 / (120000 * 8 / 100 / 12)) * 10000) / 100
    expect(months[0].monthly_icr).toBeCloseTo(expectedIcr, 1)
  })

  it('months_below_icr uses 145% for a Ltd-owned scenario vs 125% for personal', () => {
    // debt 100k stressed at the 5.5% floor -> ICR ~135% with £620 rent: clears 125%, fails 145%.
    const state = makeState({ debt: 100000, mortgage_rate: 3.5, monthly_rent: 620, monthly_mortgage: 500, monthly_other_expenses: 0 })
    const personalTax = { ...DEFAULT_TAX_SETTINGS, ownership: 'personal' as const, personal_marginal_rate_pct: 20 }
    const ltdTax = { ...DEFAULT_TAX_SETTINGS, ownership: 'ltd' as const }
    const personal = buildProjection(makeMap(state), [], { ...BASE_CONFIG, tax: personalTax })
    const ltd = buildProjection(makeMap(state), [], { ...BASE_CONFIG, tax: ltdTax })
    expect(personal.summary.months_below_icr).toBe(0)     // clears the 125% floor
    expect(ltd.summary.months_below_icr).toBe(12)          // fails the stricter 145% floor
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

// ─── Return metrics (§P2-9) ────────────────────────────────────────────────────

describe('buildProjection — return metrics', () => {
  it('total_capital_invested accumulates across a buy, a capex hit, and an ERC', () => {
    const price = 100000, depositPct = 25
    const { total: txCosts } = calcTransactionCosts(price, 2000, 0, 0, 0)
    const buy = makeEvent({
      event_type: 'buy_property', date: '2026-01-01',
      parameters_json: JSON.stringify({
        purchase_price: price, monthly_rent: 0, deposit_percent: depositPct, monthly_expenses: 0,
        mortgage_rate: 5, mortgage_term_years: 25, legal_fees: 2000, arrangement_fee: 0, valuation_fee: 0,
      }),
    })
    const { summary } = buildProjection(new Map(), [buy], {
      base_date: '2026-01-01', projection_years: 11,
      assumptions_json: JSON.stringify({ void_months_per_year: 0, expense_inflation_pct: 0, rent_growth_pct: 0, property_growth_pct: 0, arrears_pct: 0, capex_cycle_years: 10, capex_cost_per_property: 3000 }),
    })
    const deposit = price * (depositPct / 100)
    // deposit+costs at month 0, plus one capex cycle (10y from acquisition) before the 11y horizon ends
    expect(summary.total_capital_invested).toBe(Math.round(deposit + txCosts + 3000))
  })

  it('returns null return metrics when no capital has been invested', () => {
    const state = makeState({ id: 1, debt: 0, mortgage_rate: 0, monthly_mortgage: 0, monthly_rent: 1000, monthly_other_expenses: 0 })
    const { summary } = buildProjection(makeMap(state), [], BASE_CONFIG)
    expect(summary.total_capital_invested).toBe(0)
    expect(summary.equity_multiple).toBeNull()
    expect(summary.irr_pct).toBeNull()
    expect(summary.roce_pct).toBeNull()
    expect(summary.cash_on_cash_pct).toBeNull()
    expect(summary.net_yield_on_cost_pct).toBeNull()
    expect(summary.months_to_payback).toBeNull()
  })

  it('a cash purchase produces a sane equity multiple and cash-on-cash yield', () => {
    const buy = makeEvent({
      event_type: 'buy_property', date: '2026-01-01',
      parameters_json: JSON.stringify({ purchase_price: 66000, monthly_rent: 700, deposit_percent: 100, monthly_expenses: 0, legal_fees: 0, arrangement_fee: 0, valuation_fee: 0 }),
    })
    const { summary } = buildProjection(new Map(), [buy], {
      base_date: '2026-01-01', projection_years: 1,
      assumptions_json: JSON.stringify({ void_months_per_year: 0, expense_inflation_pct: 0, rent_growth_pct: 0, property_growth_pct: 0, arrears_pct: 0 }),
    })
    expect(summary.total_capital_invested).toBe(71280)   // £66k deposit + £5,280 ADS (no LBTT below £145k)
    expect(summary.equity_multiple).not.toBeNull()
    expect(summary.equity_multiple!).toBeGreaterThan(1)   // rent received on top of the £66k cost basis
    expect(summary.cash_on_cash_pct).not.toBeNull()
    expect(summary.cash_on_cash_pct!).toBeCloseTo((700 * 12 / 71280) * 100, 0)
  })

  it('months_to_payback fires once cumulative cashflow recovers to the starting position', () => {
    const buy = makeEvent({
      event_type: 'buy_property', date: '2026-01-01',
      parameters_json: JSON.stringify({ purchase_price: 12000, monthly_rent: 1200, deposit_percent: 100, monthly_expenses: 0, legal_fees: 0, arrangement_fee: 0, valuation_fee: 0 }),
    })
    const { summary } = buildProjection(new Map(), [buy], {
      base_date: '2026-01-01', projection_years: 2,
      assumptions_json: JSON.stringify({ void_months_per_year: 0, expense_inflation_pct: 0, rent_growth_pct: 0, property_growth_pct: 0, arrears_pct: 0 }),
    })
    // £12k cost, £1,200/mo rent (month 0 already includes one rent payment) → recovers by month 9
    expect(summary.months_to_payback).toBe(9)
  })

  it('debt_calendar lists each mortgaged property\'s maturity and next-reprice date', () => {
    const state = makeState({
      id: 1, debt: 100000, mortgage_rate: 5, monthly_mortgage: calcMonthlyPayment(100000, 5, 300),
      is_fixed_rate: true, mortgage_term_months: 300, next_reprice_month: 12,
    })
    const proj = buildProjection(makeMap(state), [], {
      base_date: '2026-01-01', projection_years: 1,
      assumptions_json: JSON.stringify({ void_months_per_year: 0, expense_inflation_pct: 0, rent_growth_pct: 0, property_growth_pct: 0, arrears_pct: 0, mortgage_reprice_years: 5, mortgage_reprice_uplift_bps: 200 }),
    })
    const entry = proj.debt_calendar.find(e => e.property_id === 1)!
    expect(entry).toBeDefined()
    expect(entry.next_reprice_date).toBe('2027-01-01')       // month 12 from 2026-01-01
    expect(entry.maturity_date).toBe('2051-01-01')           // 300 months (25y) from 2026-01-01
  })

  it('a fully paid-off property is excluded from the debt calendar', () => {
    const state = makeState({
      id: 1, debt: 100000, mortgage_rate: 5, monthly_mortgage: calcMonthlyPayment(100000, 5, 300),
      is_fixed_rate: true, mortgage_term_months: 300, next_reprice_month: 12,
    })
    const proj = buildProjection(
      makeMap(state),
      [makeEvent({ event_type: 'payoff_mortgage', date: '2026-01-01', property_id: 1, parameters_json: '{}' })],
      BASE_CONFIG
    )
    expect(proj.debt_calendar.find(e => e.property_id === 1)).toBeUndefined()
  })
})
