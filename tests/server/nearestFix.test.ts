import { describe, it, expect } from 'vitest'
import { bracketAndBisect, computeNearestFixes } from '../../server/services/nearestFix.ts'
import { runTemplate, TEMPLATES, type Goal, type PropertyAssumptions } from '../../server/services/pathwayGenerator.ts'
import type { PropertyState } from '../../server/services/scenarioEngine.ts'

// One cashflow-positive property so the cash pot grows slowly without loans — mirrors the
// fixture already used in pathwayGenerator.test.ts.
function startingPortfolio(): Map<number, PropertyState> {
  return new Map([[1, {
    id: 1, value: 200000, monthly_rent: 1200, monthly_mortgage: 600, monthly_other_expenses: 100,
    debt: 120000, is_vacant: false, mortgage_rate: 5.5, is_interest_only: false, purchase_price: 150000,
  }]])
}

const PROJECTION_YEARS = 15

describe('bracketAndBisect', () => {
  it('converges to within 1% of a known threshold, direction "up"', () => {
    const threshold = 137
    const to = bracketAndBisect((v) => v >= threshold, 100, 'up')
    expect(to).not.toBeNull()
    expect(to!).toBeGreaterThanOrEqual(threshold)
    expect(to! - threshold).toBeLessThan(threshold * 0.01 + 1)
  })

  it('converges to within 1% of a known threshold, direction "down"', () => {
    const threshold = 4 // reaches_goal true once value <= 4
    const to = bracketAndBisect((v) => v <= threshold, 12, 'down', { floor: 1 })
    expect(to).not.toBeNull()
    expect(to!).toBeLessThanOrEqual(threshold)
  })

  it('returns null when the threshold is out of the bracket range', () => {
    // Threshold needs value >= 100000 but current is 100 with default deltas — well outside
    // 5 doubling probes.
    const to = bracketAndBisect((v) => v >= 100000, 100, 'up')
    expect(to).toBeNull()
  })
})

describe('computeNearestFixes — ICR-blocked candidate deal (real "10 Properties"-shaped case)', () => {
  // Same shape as the real goal that surfaced the binding_detail fix: a low-yield deal whose
  // stressed ICR never clears the lender floor, so zero buys ever happen.
  const unfinanceableDeal: PropertyAssumptions = {
    purchase_price: 180000,
    monthly_rent: 950,
    monthly_expenses: 200,
    deposit_percent: 25,
    mortgage_rate: 5.5,
    mortgage_term_years: 25,
  }
  // Only one more property needed, with ample starting cash — isolates the lender ICR gate as
  // the sole blocker (a 10-property target would also be capital-bound, muddying which lever
  // the fix should target).
  const goal: Goal = { goal_type: 'count', target_property_count: 2, starting_cash: 60000 }
  const t = TEMPLATES.find(tpl => tpl.template_name === 'target_hold')!

  it('never returns hints for a pathway that already reaches goal', () => {
    const reachingGoal: Goal = { goal_type: 'count', target_property_count: 1 }
    const reachingPw = runTemplate(t, reachingGoal, startingPortfolio(), { purchase_price: 100000, monthly_rent: 800, deposit_percent: 25, mortgage_rate: 5.5, mortgage_term_years: 25 }, PROJECTION_YEARS)
    expect(reachingPw.reaches_goal).toBe(true)
    const fixes = computeNearestFixes(reachingPw, t, reachingGoal, startingPortfolio(), { purchase_price: 100000, monthly_rent: 800, deposit_percent: 25, mortgage_rate: 5.5, mortgage_term_years: 25 }, PROJECTION_YEARS)
    expect(fixes).toEqual([])
  })

  it('finds a rent-uplift fix that round-trips: applying it actually flips reaches_goal', () => {
    const pw = runTemplate(t, goal, startingPortfolio(), unfinanceableDeal, PROJECTION_YEARS)
    expect(pw.reaches_goal).toBe(false)
    expect(pw.binding_constraint).toBe('icr')

    const fixes = computeNearestFixes(pw, t, goal, startingPortfolio(), unfinanceableDeal, PROJECTION_YEARS)
    expect(fixes.length).toBeGreaterThan(0)
    const rentFix = fixes.find(f => f.lever === 'monthly_rent')
    expect(rentFix).toBeDefined()
    expect(rentFix!.to).toBeGreaterThan(unfinanceableDeal.monthly_rent)

    // Round-trip: apply the fix and confirm it actually flips reaches_goal.
    const flipped = runTemplate(t, goal, startingPortfolio(), { ...unfinanceableDeal, monthly_rent: rentFix!.to }, PROJECTION_YEARS)
    expect(flipped.reaches_goal).toBe(true)

    // A value 1% below the fix should not (still) reach goal — pins the fix as genuinely the
    // smallest verified change, not an overshoot.
    const belowFix = runTemplate(t, goal, startingPortfolio(), { ...unfinanceableDeal, monthly_rent: rentFix!.to * 0.99 }, PROJECTION_YEARS)
    expect(belowFix.reaches_goal).toBe(false)
  })
})

describe('computeNearestFixes — degenerate case', () => {
  it('returns an empty array when no single-lever change within budget suffices', () => {
    // An absurdly distant count target — no realistic director-loan/starting-cash/horizon bump
    // within the search budget gets anywhere near 500 properties in 15 years.
    const goal: Goal = { goal_type: 'count', target_property_count: 500 }
    const assumptions: PropertyAssumptions = {
      purchase_price: 100000, monthly_rent: 800, deposit_percent: 25, mortgage_rate: 5.5, mortgage_term_years: 25,
    }
    const t = TEMPLATES.find(tpl => tpl.template_name === 'max_cashflow')!
    const pw = runTemplate(t, goal, startingPortfolio(), assumptions, PROJECTION_YEARS)
    expect(pw.reaches_goal).toBe(false)

    const fixes = computeNearestFixes(pw, t, goal, startingPortfolio(), assumptions, PROJECTION_YEARS)
    expect(fixes).toEqual([])
  })
})
