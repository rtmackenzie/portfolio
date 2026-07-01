import { queryAll } from '../db/database.ts'
import { calcMonthlyPayment, calcTransactionCosts } from './calculations.ts'
import { incomeTaxForMonth, disposalTax, icrThresholdPct, type TaxSettings } from './tax.ts'
import { loadTaxSettings, loadAssumptionSettings } from './settings.ts'
import type { AssumptionSettings } from './assumptions.ts'

interface ScenarioConfig {
  base_date: string
  projection_years: number
  assumptions_json?: string | null
  rate_shock_bps?: number
  rent_shock_pct?: number
  propertyLabels?: Record<number, string>
  tax?: TaxSettings   // global tax settings; when absent, post-tax == pre-tax
  starting_cash?: number   // real cash on hand at month 0; default 0 (today's behaviour)
  defaults?: Partial<AssumptionSettings>   // global assumption defaults; caller-injected, engine literal is the final fallback
}

export interface ScenarioEvent {
  event_type: string
  property_id?: number | null
  date: string
  parameters_json: string
}

export interface PropertyState {
  id: number
  value: number
  monthly_rent: number
  monthly_mortgage: number
  monthly_other_expenses: number
  debt: number
  is_vacant: boolean
  mortgage_rate: number      // annual %, 0 = no mortgage
  is_interest_only: boolean  // if true, principal is never reduced
  purchase_price: number     // cost basis for CGT on disposal
  acquired_month?: number    // absolute month index when acquired; 0 (default) = held at projection start
  is_fixed_rate?: boolean       // only fixed-rate mortgages auto-reprice; trackers hold flat
  fixed_period_end?: string | null  // calendar date; consumed once at init to seed next_reprice_month
  mortgage_term_months?: number     // needed to compute remaining term at reprice (repayment only)
  next_reprice_month?: number | null  // absolute month index of the next scheduled reprice
  next_capex_month?: number | null    // absolute month index of the next scheduled lumpy-capex hit (§6b)
}

interface MonthSnapshot {
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
  monthly_cover_ratio: number   // rent ÷ actual mortgage payment — a cashflow-cover figure, not a lender test
  monthly_icr: number           // rent ÷ stressed interest-only payment, % — the real lender affordability test (P0 #4)
}

// Pure projection engine — accepts initial state directly, no DB access.
// Exported for unit testing; runScenario() calls this after loading from DB.
export function buildProjection(
  initialState: Map<number, PropertyState>,
  events: ScenarioEvent[],
  config: ScenarioConfig
) {
  // Deep-clone state so the caller's map isn't mutated
  const stateMap = new Map<number, PropertyState>(
    Array.from(initialState.entries()).map(([k, v]) => [k, { ...v }])
  )

  const propLabels = new Map<number, string>()
  for (const [id] of stateMap) {
    propLabels.set(id, config.propertyLabels?.[id] ?? `Property ${id}`)
  }
  type PropMonthEntry = { date: string; value: number; debt: number; equity: number; monthly_cashflow: number; cumulative_cashflow: number; is_fixed_rate: boolean; next_reprice_month: number | null }
  const propMonths = new Map<number, PropMonthEntry[]>()
  const propCumCashflow = new Map<number, number>()
  for (const [id] of stateMap) { propMonths.set(id, []); propCumCashflow.set(id, 0) }

  const eventsByDate = new Map<string, ScenarioEvent[]>()
  for (const ev of events) {
    const key = ev.date.substring(0, 7) // YYYY-MM
    if (!eventsByDate.has(key)) eventsByDate.set(key, [])
    eventsByDate.get(key)!.push(ev)
  }

  // Mutable running debt balances — updated iteratively each month via amortisation.
  // Separate from stateMap so events can read the live balance (e.g. payoff cheapest).
  const debtMap = new Map<number, number>()
  for (const [id, state] of stateMap) {
    debtMap.set(id, state.debt)
  }

  if (config.rate_shock_bps) {
    for (const state of stateMap.values()) {
      state.monthly_mortgage *= (1 + config.rate_shock_bps / 10000)
      state.mortgage_rate    += config.rate_shock_bps / 100
    }
  }
  if (config.rent_shock_pct) {
    for (const state of stateMap.values()) {
      state.monthly_rent *= (1 + config.rent_shock_pct / 100)
    }
  }

  const assumptions = JSON.parse(config.assumptions_json ?? '{}')
  const growthRate     = assumptions.property_growth_pct   ?? config.defaults?.default_property_growth_pct   ?? 3.0
  const inflationRate  = assumptions.expense_inflation_pct ?? config.defaults?.default_expense_inflation_pct ?? 2.5
  const rentGrowthRate = assumptions.rent_growth_pct       ?? config.defaults?.default_rent_growth_pct       ?? 2.5
  const voidMonths     = assumptions.void_months_per_year  ?? config.defaults?.default_void_months_per_year  ?? 1
  const voidFactor     = 1 - voidMonths / 12
  // Rent arrears/bad debt: a flat % rent reduction every month, distinct from void (§6b).
  const arrearsPct     = assumptions.arrears_pct ?? config.defaults?.arrears_pct ?? 1.5
  const arrearsFactor  = 1 - arrearsPct / 100
  // Fixed-rate mortgages revert/refix on a schedule; trackers hold flat (§6.3 fix).
  const repriceYears     = assumptions.mortgage_reprice_years      ?? 5
  const repriceUpliftBps = assumptions.mortgage_reprice_uplift_bps ?? 200
  // Early Repayment Charge: a flat % of balance charged when a fixed deal is paid
  // off or refinanced away before its fix naturally ends (§P1-6 acquisition-fees fix).
  const ercPct = assumptions.erc_pct ?? 3
  // Lender ICR stress test (P0 #4): rent vs. an interest-only payment at the higher
  // of pay-rate+uplift or a rate floor — the standard UK BTL affordability test.
  const stressUplift = (config.defaults?.icr_stress_uplift_bps ?? 200) / 100
  const stressFloor = config.defaults?.icr_stress_floor_pct ?? 5.5
  // Lumpy capex (boiler/roof/kitchens): a lump sum charged per property every N years,
  // mirroring the fixed-rate reprice schedule (§6b).
  const capexCycleYears = assumptions.capex_cycle_years ?? config.defaults?.capex_cycle_years ?? 10
  const capexCostPerProperty = assumptions.capex_cost_per_property ?? config.defaults?.capex_cost_per_property ?? 3000

  const snapshots: MonthSnapshot[] = []
  let cumulativeCashflow = config.starting_cash ?? 0
  let taxCumulative = 0   // running income tax + CGT (post-tax = pre-tax − this)
  let nextId = Math.max(...Array.from(stateMap.keys()), 0) + 1
  const tax = config.tax

  // Use UTC-safe arithmetic to avoid DST/timezone shifts corrupting month keys
  const baseDate = new Date(config.base_date)
  const baseYear = baseDate.getUTCFullYear()
  const baseMonth = baseDate.getUTCMonth()
  const totalMonths = (config.projection_years ?? 10) * 12

  // Seed the first scheduled reprice for existing fixed-rate holdings from their real
  // fixed_period_end date (properties bought mid-projection are seeded in buy_property).
  for (const state of stateMap.values()) {
    if (state.is_fixed_rate && state.fixed_period_end) {
      const end = new Date(state.fixed_period_end)
      const absEndMonth = (end.getUTCFullYear() - baseYear) * 12 + (end.getUTCMonth() - baseMonth)
      state.next_reprice_month = absEndMonth >= 0 ? absEndMonth : 0
    }
    // Seed the first capex cycle for existing holdings. There's no real "last refurb
    // date" in the DB, so — like the mortgage-term-months approximation above — this
    // assumes a fresh cycle starts at the projection base date (§6b).
    if (state.next_capex_month == null) {
      state.next_capex_month = (state.acquired_month ?? 0) + capexCycleYears * 12
    }
  }

  for (let i = 0; i < totalMonths; i++) {
    const absMonth = baseMonth + i
    const year = baseYear + Math.floor(absMonth / 12)
    const month = absMonth % 12
    const yearMonth = `${year}-${String(month + 1).padStart(2, '0')}`

    const monthEvents = eventsByDate.get(yearMonth) ?? []
    for (const ev of monthEvents) {
      const params = JSON.parse(ev.parameters_json ?? '{}')

      switch (ev.event_type) {
        case 'buy_property': {
          const depositPct = params.deposit_percent ?? config.defaults?.default_deposit_percent ?? 25
          const price = params.purchase_price ?? 0
          const rate = (params.mortgage_rate ?? config.defaults?.default_mortgage_rate_pct ?? 5.5) + (config.rate_shock_bps ?? 0) / 100
          const termYears = params.mortgage_term_years ?? 25
          const debt = price * (1 - depositPct / 100)
          const isIO = params.interest_only ?? false
          const monthly_mortgage = isIO
            ? (debt * rate / 100) / 12
            : calcMonthlyPayment(debt, rate, termYears * 12)
          const newId = nextId++
          stateMap.set(newId, {
            id: newId,
            value: price,
            monthly_rent: (params.monthly_rent ?? 0) * (1 + (config.rent_shock_pct ?? 0) / 100),
            monthly_mortgage,
            monthly_other_expenses: params.monthly_expenses ?? 200,
            debt,
            is_vacant: false,
            mortgage_rate: rate,
            is_interest_only: isIO,
            purchase_price: price,
            acquired_month: i,
            is_fixed_rate: true,   // pathway-generated / manually-added purchases assumed fixed
            mortgage_term_months: isIO ? undefined : termYears * 12,
            next_reprice_month: isIO ? null : i + repriceYears * 12,
            next_capex_month: i + capexCycleYears * 12,
          })
          debtMap.set(newId, debt)
          propLabels.set(newId, params.address ?? `New Property ${newId}`)
          propMonths.set(newId, [])
          propCumCashflow.set(newId, 0)
          const { total: txCosts } = calcTransactionCosts(
            price,
            params.legal_fees ?? config.defaults?.default_legal_fees ?? 2000,
            params.refurb_costs ?? 0,
            params.arrangement_fee ?? config.defaults?.default_arrangement_fee ?? 999,
            params.valuation_fee ?? config.defaults?.default_valuation_fee ?? 300
          )
          // Deposit + transaction costs are a real capital outflow drawn from the
          // accumulated cash pot (retained cashflow + director loans).
          const deposit = price * (depositPct / 100)
          cumulativeCashflow -= deposit + txCosts
          break
        }
        case 'sell_property': {
          const sellId = ev.property_id
          const state = sellId ? stateMap.get(sellId) : null
          if (state && sellId != null) {
            const growthFactor = Math.pow(1 + growthRate / 100, i / 12)
            const saleValue = params.sale_price ?? state.value * growthFactor
            const currentDebt = debtMap.get(sellId) ?? 0
            const t = tax ?? { ownership: 'personal' as const, personal_marginal_rate_pct: 0, s24_credit_rate_pct: 0, corp_tax_rate_pct: 0, cgt_rate_pct: 0, cgt_annual_exempt: 0, selling_costs_pct: 0 }
            const { cgt, netProceedsPreTax } = disposalTax(t, {
              saleValue,
              costBasis: state.purchase_price,
              sellingCosts: params.selling_costs,
            })
            // Sale realises equity: net of selling costs and debt repayment into cash.
            cumulativeCashflow += netProceedsPreTax - currentDebt
            taxCumulative += cgt
            stateMap.delete(sellId)
            debtMap.delete(sellId)
          }
          break
        }
        case 'remortgage': {
          const propId = ev.property_id
          const state = propId ? stateMap.get(propId) : null
          if (state && propId != null) {
            const currentDebt = debtMap.get(propId) ?? 0
            const newRate    = (params.new_rate ?? state.mortgage_rate) + (config.rate_shock_bps ?? 0) / 100
            const newTermYrs = params.new_term_years ?? 25
            const isIO       = !!(params.interest_only)
            const newDebt    = params.new_balance != null ? params.new_balance : currentDebt

            if (newDebt > currentDebt) {
              cumulativeCashflow += newDebt - currentDebt
            }
            // ERC: refinancing away from a fixed deal before it naturally reprices
            // is an early exit on the balance being replaced.
            if (state.is_fixed_rate && state.next_reprice_month != null && i < state.next_reprice_month) {
              cumulativeCashflow -= currentDebt * (ercPct / 100)
            }
            cumulativeCashflow -= (params.arrangement_fee ?? 0) + (params.valuation_fee ?? 0)

            state.monthly_mortgage = calcMonthlyPayment(newDebt, newRate, isIO ? 0 : newTermYrs * 12)
            state.mortgage_rate    = newRate
            state.is_interest_only = isIO
            // Keep scheduled auto-repricing (§6.3) in sync with the new deal.
            state.mortgage_term_months = isIO ? undefined : newTermYrs * 12
            state.next_reprice_month = isIO ? null : i + repriceYears * 12
            debtMap.set(propId, newDebt)
          }
          break
        }
        case 'rent_change': {
          if (ev.property_id) {
            const state = stateMap.get(ev.property_id)
            if (state) {
              state.monthly_rent = params.new_rent ?? state.monthly_rent * (1 + (params.change_percent ?? 0) / 100)
            }
          } else {
            for (const state of stateMap.values()) {
              state.monthly_rent = params.new_rent ?? state.monthly_rent * (1 + (params.change_percent ?? 0) / 100)
            }
          }
          break
        }
        case 'vacancy_period': {
          const state = ev.property_id ? stateMap.get(ev.property_id) : null
          if (state) state.is_vacant = true
          break
        }
        case 'interest_rate_change': {
          const bps = params.change_basis_points ?? 0
          for (const state of stateMap.values()) {
            state.monthly_mortgage *= (1 + bps / 10000)
            state.mortgage_rate += bps / 100
          }
          break
        }
        case 'payoff_mortgage': {
          let targetId: number | null = null
          if (ev.property_id) {
            targetId = ev.property_id
          } else {
            // No specific property targeted — pay off the one with the smallest current balance
            let cheapestDebt = Infinity
            for (const [id, s] of stateMap) {
              const currentDebt = debtMap.get(id) ?? 0
              if (s.monthly_mortgage > 0 && currentDebt < cheapestDebt) {
                cheapestDebt = currentDebt
                targetId = id
              }
            }
          }
          const state = targetId !== null ? stateMap.get(targetId) : null
          if (state && targetId !== null) {
            // Capital event — the cleared balance is a real outflow drawn from the
            // accumulated cash pot (retained cashflow + director loans).
            const clearedBalance = debtMap.get(targetId) ?? 0
            // ERC: clearing a fixed deal before it naturally reprices is an early
            // exit and typically costs 1–5% of the balance in reality.
            if (state.is_fixed_rate && state.next_reprice_month != null && i < state.next_reprice_month) {
              cumulativeCashflow -= clearedBalance * (ercPct / 100)
            }
            cumulativeCashflow -= clearedBalance
            state.monthly_mortgage = 0
            state.debt = 0
            debtMap.set(targetId, 0)
          }
          break
        }
        case 'major_expense': {
          cumulativeCashflow -= params.amount ?? 0
          break
        }
        case 'director_loan_in': {
          cumulativeCashflow += params.amount ?? 0
          break
        }
        case 'director_loan_repay': {
          cumulativeCashflow -= params.amount ?? 0
          break
        }
      }
    }

    let totalValue = 0
    let totalDebt = 0
    let monthlyCashflow = 0
    let totalRent = 0
    let totalMortgage = 0
    let totalExpenses = 0
    let totalInterest = 0
    let totalStressedInterest = 0

    for (const [propId, state] of stateMap) {
      // Grow each property from its own acquisition month — not the projection
      // base date — so mid-projection purchases enter at price/base rent (§D1 fix).
      const age = Math.max(0, i - (state.acquired_month ?? 0)) / 12
      const growthFactor = Math.pow(1 + growthRate / 100, age)
      const currentValue = state.value * growthFactor

      // Iterative amortisation: subtract principal portion of payment from running balance.
      // Interest-only and no-mortgage properties keep their balance constant.
      let currentDebt = debtMap.get(propId) ?? 0

      // Fixed-rate expiry & repricing (§6.3 fix): revert to a higher rate on schedule,
      // re-amortising over the remaining term at the current balance. Trackers
      // (is_fixed_rate falsy) and paid-off mortgages are never repriced.
      if (state.is_fixed_rate && state.next_reprice_month != null && i === state.next_reprice_month && currentDebt > 0) {
        const newRate = state.mortgage_rate + repriceUpliftBps / 100
        const elapsed = i - (state.acquired_month ?? 0)
        const remainingTermMonths = state.is_interest_only ? 0 : Math.max(1, (state.mortgage_term_months ?? 300) - elapsed)
        state.monthly_mortgage = state.is_interest_only
          ? (currentDebt * newRate / 100) / 12
          : calcMonthlyPayment(currentDebt, newRate, remainingTermMonths)
        state.mortgage_rate = newRate
        state.next_reprice_month = i + repriceYears * 12
      }

      // Lumpy capex (boiler/roof/kitchens): a one-off lump sum every N years per
      // property, independent of financing — a capital event, so it's applied directly
      // to cumulativeCashflow rather than through this property's monthly P&L line,
      // the same treatment already given to deposits, fees and ERC (§6b).
      if (state.next_capex_month != null && i === state.next_capex_month) {
        cumulativeCashflow -= capexCostPerProperty
        state.next_capex_month = i + capexCycleYears * 12
      }

      // Interest portion of this month's payment (for tax — principal is not deductible).
      const monthlyInterest = (currentDebt > 0 && state.mortgage_rate > 0)
        ? currentDebt * (state.mortgage_rate / 100 / 12)
        : 0
      const stressRate = Math.max(state.mortgage_rate + stressUplift, stressFloor)
      const stressedInterest = currentDebt > 0 ? currentDebt * (stressRate / 100 / 12) : 0
      if (currentDebt > 0 && !state.is_interest_only && state.mortgage_rate > 0) {
        const principal = Math.max(0, state.monthly_mortgage - monthlyInterest)
        currentDebt = Math.max(0, currentDebt - principal)
        debtMap.set(propId, currentDebt)
      }

      totalValue += currentValue
      totalDebt += currentDebt

      const rentGrowthFactor = Math.pow(1 + rentGrowthRate / 100, age)
      const rent = state.is_vacant ? 0 : state.monthly_rent * voidFactor * arrearsFactor * rentGrowthFactor
      const inflationFactor = Math.pow(1 + inflationRate / 100, age)
      const expenses = state.monthly_other_expenses * inflationFactor
      const propCashflow = rent - state.monthly_mortgage - expenses
      monthlyCashflow += propCashflow
      totalRent     += rent
      totalMortgage += state.monthly_mortgage
      totalExpenses += expenses
      totalInterest += monthlyInterest
      totalStressedInterest += stressedInterest

      const prevCum = propCumCashflow.get(propId) ?? 0
      const newCum = prevCum + propCashflow
      propCumCashflow.set(propId, newCum)
      propMonths.get(propId)?.push({
        date: yearMonth,
        value: Math.round(currentValue),
        debt: Math.round(currentDebt),
        equity: Math.round(currentValue - currentDebt),
        monthly_cashflow: Math.round(propCashflow),
        cumulative_cashflow: Math.round(newCum),
        is_fixed_rate: !!state.is_fixed_rate,
        next_reprice_month: state.next_reprice_month ?? null,
      })
    }

    cumulativeCashflow += monthlyCashflow
    // Income tax on this month's portfolio profit (0 when no tax settings supplied).
    const monthlyTax = tax ? incomeTaxForMonth(tax, { rent: totalRent, expenses: totalExpenses, interest: totalInterest }) : 0
    taxCumulative += monthlyTax
    const equity = totalValue - totalDebt
    const coverRatio = totalMortgage > 0 ? Math.round((totalRent / totalMortgage) * 100) / 100 : 0
    const icr = totalStressedInterest > 0 ? Math.round((totalRent / totalStressedInterest) * 10000) / 100 : 0

    snapshots.push({
      date: yearMonth,
      total_value: Math.round(totalValue),
      total_debt: Math.round(totalDebt),
      total_equity: Math.round(equity),
      monthly_cashflow: Math.round(monthlyCashflow),
      cumulative_cashflow: Math.round(cumulativeCashflow),
      monthly_cashflow_posttax: Math.round(monthlyCashflow - monthlyTax),
      cumulative_cashflow_posttax: Math.round(cumulativeCashflow - taxCumulative),
      monthly_tax: Math.round(monthlyTax),
      property_count: stateMap.size,
      monthly_cover_ratio: coverRatio,
      monthly_icr: icr,
    })
  }

  const property_series = Array.from(propMonths.entries()).map(([id, months]) => ({
    property_id: id,
    label: propLabels.get(id) ?? `Property ${id}`,
    months,
  }))

  const first = snapshots[0]
  const last = snapshots[snapshots.length - 1]
  const nonZeroCover = snapshots.filter(s => s.monthly_cover_ratio > 0)
  const nonZeroIcr = snapshots.filter(s => s.monthly_icr > 0)
  const icrFloor = icrThresholdPct(tax)

  return {
    months: snapshots,
    property_series,
    summary: {
      start_equity: first?.total_equity ?? 0,
      end_equity: last?.total_equity ?? 0,
      equity_growth: last && first ? last.total_equity - first.total_equity : 0,
      equity_growth_pct: first?.total_equity > 0
        ? Math.round(((last.total_equity - first.total_equity) / first.total_equity) * 10000) / 100
        : 0,
      total_cashflow: last?.cumulative_cashflow ?? 0,
      avg_monthly_cashflow: snapshots.length > 0
        ? Math.round(snapshots.reduce((s, m) => s + m.monthly_cashflow, 0) / snapshots.length)
        : 0,
      ending_monthly_cashflow: last?.monthly_cashflow ?? 0,
      total_cashflow_posttax: last?.cumulative_cashflow_posttax ?? 0,
      avg_monthly_cashflow_posttax: snapshots.length > 0
        ? Math.round(snapshots.reduce((s, m) => s + m.monthly_cashflow_posttax, 0) / snapshots.length)
        : 0,
      ending_monthly_cashflow_posttax: last?.monthly_cashflow_posttax ?? 0,
      total_tax_paid: Math.round(taxCumulative),
      min_cover_ratio: nonZeroCover.length > 0
        ? Math.round(Math.min(...nonZeroCover.map(s => s.monthly_cover_ratio)) * 100) / 100
        : 0,
      months_below_cover: snapshots.filter(s => s.monthly_cover_ratio > 0 && s.monthly_cover_ratio < 1.25).length,
      min_icr: nonZeroIcr.length > 0
        ? Math.round(Math.min(...nonZeroIcr.map(s => s.monthly_icr)) * 100) / 100
        : 0,
      months_below_icr: snapshots.filter(s => s.monthly_icr > 0 && s.monthly_icr < icrFloor).length,
      min_cumulative_cashflow: snapshots.length > 0
        ? Math.min(...snapshots.map(s => s.cumulative_cashflow))
        : 0,
      min_cumulative_cashflow_posttax: snapshots.length > 0
        ? Math.min(...snapshots.map(s => s.cumulative_cashflow_posttax))
        : 0,
    },
  }
}

export function loadPortfolioState(): {
  initialState: Map<number, PropertyState>
  propertyLabels: Record<number, string>
  activeMortgageCount: number
} {
  const dbProperties = queryAll<{
    id: number; current_value: number | null; purchase_price: number | null; address_line1: string; town: string;
  }>('SELECT id, current_value, purchase_price, address_line1, town FROM properties')

  const dbTenants = queryAll<{ property_id: number; rent_amount: number; status: string }>(
    "SELECT property_id, rent_amount, status FROM tenants WHERE status='active'"
  )

  const dbMortgages = queryAll<{
    property_id: number; monthly_payment: number; current_balance: number;
    is_active: number; interest_rate: number; type: string; fixed_period_end: string | null;
  }>(
    'SELECT property_id, monthly_payment, current_balance, is_active, interest_rate, type, fixed_period_end FROM mortgages WHERE is_active=1'
  )

  const dbExpenses = queryAll<{ property_id: number | null; amount: number; frequency: string; active: number }>(
    'SELECT property_id, amount, frequency, active FROM expenses WHERE active=1'
  )

  const toMonthly = (e: { amount: number; frequency: string }) => {
    if (e.frequency === 'monthly') return e.amount
    if (e.frequency === 'quarterly') return e.amount / 3
    if (e.frequency === 'annually') return e.amount / 12
    return 0
  }

  // Portfolio-wide expenses (property_id = null) must be summed once and
  // distributed evenly — not added inside the per-property loop (which would
  // multiply them by the number of properties).
  const portfolioExpensesMonthly = dbExpenses
    .filter(e => e.property_id === null)
    .reduce((s, e) => s + toMonthly(e), 0)
  const perPropertyShare = dbProperties.length > 0 ? portfolioExpensesMonthly / dbProperties.length : 0

  const initialState = new Map<number, PropertyState>()

  for (const p of dbProperties) {
    const tenant = dbTenants.find(t => t.property_id === p.id)

    // Sum ALL active mortgages for this property; use highest-balance one for rate/type
    const propertyMortgages = dbMortgages.filter(m => m.property_id === p.id)
    const monthly_mortgage = propertyMortgages.reduce((s, m) => s + m.monthly_payment, 0)
    const debt = propertyMortgages.reduce((s, m) => s + m.current_balance, 0)
    const primaryMortgage = propertyMortgages.sort((a, b) => b.current_balance - a.current_balance)[0]

    const propertyExpensesMonthly = dbExpenses
      .filter(e => e.property_id === p.id)
      .reduce((s, e) => s + toMonthly(e), 0)

    initialState.set(p.id, {
      id: p.id,
      value: p.current_value ?? p.purchase_price ?? 0,
      monthly_rent: tenant?.rent_amount ?? 0,
      monthly_mortgage,
      monthly_other_expenses: propertyExpensesMonthly + perPropertyShare,
      debt,
      is_vacant: !tenant,
      mortgage_rate: primaryMortgage?.interest_rate ?? 0,
      is_interest_only: primaryMortgage?.type === 'interest_only',
      purchase_price: p.purchase_price ?? p.current_value ?? 0,
      acquired_month: 0,   // held at projection start — grows from base date
      is_fixed_rate: primaryMortgage?.type === 'fixed',
      fixed_period_end: primaryMortgage?.fixed_period_end ?? null,
      // DB has no original-term column for existing mortgages; 300mo (25y) is a
      // documented approximation used only to size the post-reprice payment.
      mortgage_term_months: 300,
    })
  }

  const propertyLabels: Record<number, string> = {}
  for (const p of dbProperties) propertyLabels[p.id] = `${p.address_line1}, ${p.town}`

  const activeMortgageCount = new Set(dbMortgages.map(m => m.property_id)).size

  return { initialState, propertyLabels, activeMortgageCount }
}

export function runScenario(scenario: ScenarioConfig, events: ScenarioEvent[]) {
  const { initialState, propertyLabels } = loadPortfolioState()
  const tax = scenario.tax ?? loadTaxSettings()
  const defaults = scenario.defaults ?? loadAssumptionSettings()
  return buildProjection(initialState, events, { ...scenario, propertyLabels, tax, defaults })
}
