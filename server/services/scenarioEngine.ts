import { queryAll } from '../db/database.ts'

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
          const debt = price * (1 - depositPct / 100)
          stateMap.set(nextId++, {
            id: nextId - 1,
            value: price,
            monthly_rent: params.monthly_rent ?? 0,
            monthly_mortgage: (debt * (params.mortgage_rate ?? 5.5) / 100) / 12,
            monthly_other_expenses: params.monthly_expenses ?? 200,
            debt,
            is_vacant: false,
          })
          break
        }
        case 'sell_property': {
          if (ev.property_id) stateMap.delete(ev.property_id)
          break
        }
        case 'remortgage': {
          const state = ev.property_id ? stateMap.get(ev.property_id) : null
          if (state) {
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

    for (const state of stateMap.values()) {
      // Approximate 3% annual property growth
      const growthFactor = Math.pow(1.03, i / 12)
      const currentValue = state.value * growthFactor

      // Approximate 1% annual debt decay
      const debtDecay = Math.pow(0.99, i / 12)
      const currentDebt = state.debt * debtDecay

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

  const dbMortgages = queryAll<{ property_id: number; monthly_payment: number; current_balance: number; is_active: number }>(
    'SELECT property_id, monthly_payment, current_balance, is_active FROM mortgages WHERE is_active=1'
  )

  const dbExpenses = queryAll<{ property_id: number | null; amount: number; frequency: string; active: number }>(
    'SELECT property_id, amount, frequency, active FROM expenses WHERE active=1'
  )

  const initialState = new Map<number, PropertyState>()

  for (const p of dbProperties) {
    const tenant = dbTenants.find(t => t.property_id === p.id)
    const mortgage = dbMortgages.find(m => m.property_id === p.id)

    const otherExpenses = dbExpenses
      .filter(e => e.property_id === p.id || e.property_id === null)
      .reduce((s, e) => {
        switch (e.frequency) {
          case 'monthly': return s + e.amount
          case 'quarterly': return s + e.amount / 3
          case 'annually': return s + e.amount / 12
          default: return s
        }
      }, 0)

    initialState.set(p.id, {
      id: p.id,
      value: p.current_value ?? p.purchase_price ?? 0,
      monthly_rent: tenant?.rent_amount ?? 0,
      monthly_mortgage: mortgage?.monthly_payment ?? 0,
      monthly_other_expenses: otherExpenses,
      debt: mortgage?.current_balance ?? 0,
      is_vacant: !tenant,
    })
  }

  return buildProjection(initialState, events, scenario)
}
