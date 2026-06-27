import { queryAll } from '../db/database.ts'
import { calcMonthlyPayment } from './calculations.ts'

interface ScenarioConfig {
  base_date: string
  projection_years: number
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
}

interface MonthSnapshot {
  date: string
  total_value: number
  total_debt: number
  total_equity: number
  monthly_cashflow: number
  cumulative_cashflow: number
  property_count: number
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

  const snapshots: MonthSnapshot[] = []
  let cumulativeCashflow = 0
  let nextId = Math.max(...Array.from(stateMap.keys()), 0) + 1

  // Use UTC-safe arithmetic to avoid DST/timezone shifts corrupting month keys
  const baseDate = new Date(config.base_date)
  const baseYear = baseDate.getUTCFullYear()
  const baseMonth = baseDate.getUTCMonth()
  const totalMonths = (config.projection_years ?? 10) * 12

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
          const depositPct = params.deposit_percent ?? 25
          const price = params.purchase_price ?? 0
          const rate = params.mortgage_rate ?? 5.5
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
            monthly_rent: params.monthly_rent ?? 0,
            monthly_mortgage,
            monthly_other_expenses: params.monthly_expenses ?? 200,
            debt,
            is_vacant: false,
            mortgage_rate: rate,
            is_interest_only: isIO,
          })
          debtMap.set(newId, debt)
          break
        }
        case 'sell_property': {
          if (ev.property_id) {
            stateMap.delete(ev.property_id)
            debtMap.delete(ev.property_id)
          }
          break
        }
        case 'remortgage': {
          const state = ev.property_id ? stateMap.get(ev.property_id) : null
          if (state) {
            // TODO: Phase 2 — extend to accept new_rate / new_balance for equity-release refi
            state.monthly_mortgage = params.new_monthly_payment ?? state.monthly_mortgage
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
            // Capital event — funded from savings/equity outside this cashflow model.
            // buy_property follows the same convention (deposit not deducted).
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
      }
    }

    let totalValue = 0
    let totalDebt = 0
    let monthlyCashflow = 0

    for (const [propId, state] of stateMap) {
      // Approximate 3% annual property growth
      const growthFactor = Math.pow(1.03, i / 12)
      const currentValue = state.value * growthFactor

      // Iterative amortisation: subtract principal portion of payment from running balance.
      // Interest-only and no-mortgage properties keep their balance constant.
      let currentDebt = debtMap.get(propId) ?? 0
      if (currentDebt > 0 && !state.is_interest_only && state.mortgage_rate > 0) {
        const monthlyRate = state.mortgage_rate / 100 / 12
        const interest = currentDebt * monthlyRate
        const principal = Math.max(0, state.monthly_mortgage - interest)
        currentDebt = Math.max(0, currentDebt - principal)
        debtMap.set(propId, currentDebt)
      }

      totalValue += currentValue
      totalDebt += currentDebt

      const rent = state.is_vacant ? 0 : state.monthly_rent
      monthlyCashflow += rent - state.monthly_mortgage - state.monthly_other_expenses
    }

    cumulativeCashflow += monthlyCashflow
    const equity = totalValue - totalDebt

    snapshots.push({
      date: yearMonth,
      total_value: Math.round(totalValue),
      total_debt: Math.round(totalDebt),
      total_equity: Math.round(equity),
      monthly_cashflow: Math.round(monthlyCashflow),
      cumulative_cashflow: Math.round(cumulativeCashflow),
      property_count: stateMap.size,
    })
  }

  const first = snapshots[0]
  const last = snapshots[snapshots.length - 1]

  return {
    months: snapshots,
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
    },
  }
}

export function runScenario(scenario: ScenarioConfig, events: ScenarioEvent[]) {
  const dbProperties = queryAll<{
    id: number; current_value: number | null; purchase_price: number | null;
  }>('SELECT id, current_value, purchase_price FROM properties')

  const dbTenants = queryAll<{ property_id: number; rent_amount: number; status: string }>(
    "SELECT property_id, rent_amount, status FROM tenants WHERE status='active'"
  )

  const dbMortgages = queryAll<{
    property_id: number; monthly_payment: number; current_balance: number;
    is_active: number; interest_rate: number; type: string;
  }>(
    'SELECT property_id, monthly_payment, current_balance, is_active, interest_rate, type FROM mortgages WHERE is_active=1'
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
    })
  }

  return buildProjection(initialState, events, scenario)
}
