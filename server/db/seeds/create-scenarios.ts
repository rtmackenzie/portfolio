/**
 * One-time script: creates "Path to 5 Properties" and "Path to 10 Properties" scenarios.
 * Run with: npm run create-scenarios
 * Safe to re-run — skips scenarios that already exist by name.
 */
import { queryAll, queryOne, execute, transaction } from '../database.ts'

const TODAY = new Date().toISOString().slice(0, 10)

// Advance a date string by N months
function addMonths(base: string, n: number): string {
  const d = new Date(base)
  d.setUTCMonth(d.getUTCMonth() + n)
  return d.toISOString().slice(0, 10)
}

// Compute approximate monthly mortgage payment (interest-only at given rate)
function monthlyPayment(principal: number, rate: number): number {
  return Math.round((principal * (rate / 100)) / 12)
}

interface DBMortgage {
  property_id: number
  current_balance: number
  monthly_payment: number
}

function run() {
  const existingNames = queryAll<{ name: string }>('SELECT name FROM scenarios').map(s => s.name)

  // Active mortgages sorted cheapest first (pay those off first)
  const mortgages = queryAll<DBMortgage>(
    'SELECT property_id, current_balance, monthly_payment FROM mortgages WHERE is_active=1 ORDER BY current_balance ASC'
  )

  // IDs of existing properties — new buys will be assigned IDs starting from max+1
  const propIds = queryAll<{ id: number }>('SELECT id FROM properties').map(p => p.id)
  let nextSimId = Math.max(...propIds) + 1

  // New property specs — prices within £75k–£120k
  const newProps = [
    { price: 85000,  rent: 595,  expenses: 150 },
    { price: 92000,  rent: 625,  expenses: 155 },
    { price: 78000,  rent: 550,  expenses: 130 },
    { price: 85000,  rent: 595,  expenses: 140 },
    { price: 95000,  rent: 650,  expenses: 155 },
    { price: 100000, rent: 675,  expenses: 160 },
    { price: 110000, rent: 720,  expenses: 170 },
  ]

  type Event = { type: string; pid: number | null; date: string; params: Record<string, unknown> }

  // Build event sequence obeying the max-2-mortgage rule.
  // State: list of current mortgage holders (property_id, sim or real).
  // Strategy:
  //   - If < 2 mortgages active → buy next property
  //   - If already 2 mortgages active → pay off cheapest one first
  function buildEvents(targetCount: number): Event[] {
    const events: Event[] = []
    let month = 1  // offset from TODAY
    const activeMortgages: number[] = mortgages.map(m => m.property_id) // real property IDs with mortgages
    const currentCount = propIds.length
    let bought = 0
    let propSpecIdx = 0
    const simDebt: Map<number, number> = new Map()

    // Track debt for real mortgages
    for (const m of mortgages) simDebt.set(m.property_id, m.current_balance)

    while (currentCount + bought < targetCount) {
      if (activeMortgages.length < 2) {
        // Buy next property
        const spec = newProps[propSpecIdx++]
        const deposit = spec.price * 0.25
        const principal = spec.price - deposit
        const payment = monthlyPayment(principal, 5.5)
        const simId = nextSimId++
        events.push({
          type: 'buy_property',
          pid: null,
          date: addMonths(TODAY, month),
          params: {
            purchase_price: spec.price,
            monthly_rent: spec.rent,
            deposit_percent: 25,
            mortgage_rate: 5.5,
            monthly_expenses: spec.expenses,
          },
        })
        activeMortgages.push(simId)
        simDebt.set(simId, principal)
        bought++
        month += 1
      } else {
        // Pay off the mortgage with the smallest remaining balance
        const sortedByDebt = [...activeMortgages].sort((a, b) => (simDebt.get(a) ?? 0) - (simDebt.get(b) ?? 0))
        const cheapestId = sortedByDebt[0]
        // Wait 12 months (save up / arrange equity release) then pay off
        month += 12
        // Use real property_id only for actual DB properties — simulated IDs would fail the FK constraint.
        // The engine handles null by auto-selecting the cheapest mortgaged property.
        const isRealProperty = propIds.includes(cheapestId)
        events.push({
          type: 'payoff_mortgage',
          pid: isRealProperty ? cheapestId : null,
          date: addMonths(TODAY, month),
          params: {},
        })
        activeMortgages.splice(activeMortgages.indexOf(cheapestId), 1)
        simDebt.delete(cheapestId)
        month += 1 // buy quickly after payoff frees the slot
      }
    }

    return events
  }

  transaction(() => {
    if (!existingNames.includes('Path to 5 Properties')) {
      const events = buildEvents(5)
      const result = execute(
        `INSERT INTO scenarios (name, description, base_date, projection_years) VALUES (?,?,?,?)`,
        ['Path to 5 Properties', 'Grow to 5 properties keeping max 2 mortgages active at any time. Buys in £75k–£120k range.', TODAY, 10]
      )
      const scenarioId = result.lastInsertRowid
      events.forEach((e, i) =>
        execute(
          `INSERT INTO scenario_events (scenario_id, event_type, property_id, date, parameters_json, sort_order) VALUES (?,?,?,?,?,?)`,
          [scenarioId, e.type, e.pid, e.date, JSON.stringify(e.params), i]
        )
      )
      console.log(`✓ Created "Path to 5 Properties" with ${events.length} events`)
    } else {
      console.log('  Skipped "Path to 5 Properties" — already exists')
    }

    // Reset nextSimId for the 10-property scenario (independent)
    nextSimId = Math.max(...propIds) + 1

    if (!existingNames.includes('Path to 10 Properties')) {
      const events = buildEvents(10)
      const result = execute(
        `INSERT INTO scenarios (name, description, base_date, projection_years) VALUES (?,?,?,?)`,
        ['Path to 10 Properties', 'Grow to 10 properties keeping max 2 mortgages active at any time. Buys in £75k–£120k range.', TODAY, 15]
      )
      const scenarioId = result.lastInsertRowid
      events.forEach((e, i) =>
        execute(
          `INSERT INTO scenario_events (scenario_id, event_type, property_id, date, parameters_json, sort_order) VALUES (?,?,?,?,?,?)`,
          [scenarioId, e.type, e.pid, e.date, JSON.stringify(e.params), i]
        )
      )
      console.log(`✓ Created "Path to 10 Properties" with ${events.length} events`)
    } else {
      console.log('  Skipped "Path to 10 Properties" — already exists')
    }
  })
}

run()
