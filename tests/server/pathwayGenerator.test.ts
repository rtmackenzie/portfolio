import { describe, it, expect } from 'vitest'
import { generatePathways } from '../../server/services/pathwayGenerator.ts'
import type { PropertyState } from '../../server/services/scenarioEngine.ts'

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
