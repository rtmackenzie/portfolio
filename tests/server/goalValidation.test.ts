import { describe, it, expect } from 'vitest'
import { computeGoalWarnings, computeSettingsWarnings } from '../../server/services/goalValidation.ts'
import { DEFAULT_ASSUMPTION_SETTINGS } from '../../server/services/assumptions.ts'
import { DEFAULT_TAX_SETTINGS } from '../../server/services/tax.ts'
import type { Goal } from '../../server/services/pathwayGenerator.ts'

const baseGoal: Goal = { goal_type: 'count' }

describe('computeGoalWarnings', () => {
  it('flags min_icr: 0 as silently substituting the tax-derived default', () => {
    const warnings = computeGoalWarnings({ ...baseGoal, min_icr: 0 }, DEFAULT_TAX_SETTINGS)
    expect(warnings.some(w => w.field === 'min_icr')).toBe(true)
  })

  it('does not flag min_icr when left unset (null) — the normal, recommended usage', () => {
    const warnings = computeGoalWarnings({ ...baseGoal, min_icr: null }, DEFAULT_TAX_SETTINGS)
    expect(warnings.some(w => w.field === 'min_icr')).toBe(false)
  })

  it('flags a non-zero but implausibly low min_icr as unusually permissive', () => {
    const warnings = computeGoalWarnings({ ...baseGoal, min_icr: 50 }, DEFAULT_TAX_SETTINGS)
    expect(warnings.some(w => w.field === 'min_icr')).toBe(true)
  })

  it('does not flag a sensible min_icr', () => {
    const warnings = computeGoalWarnings({ ...baseGoal, min_icr: 145 }, DEFAULT_TAX_SETTINGS)
    expect(warnings.some(w => w.field === 'min_icr')).toBe(false)
  })

  it('flags capex_reserve_per_property: 0', () => {
    const warnings = computeGoalWarnings({ ...baseGoal, capex_reserve_per_property: 0 }, DEFAULT_TAX_SETTINGS)
    expect(warnings.some(w => w.field === 'capex_reserve_per_property')).toBe(true)
  })

  it('does not flag capex_reserve_per_property when unset or positive', () => {
    expect(computeGoalWarnings({ ...baseGoal, capex_reserve_per_property: null }, DEFAULT_TAX_SETTINGS).length).toBe(0)
    expect(computeGoalWarnings({ ...baseGoal, capex_reserve_per_property: 1500 }, DEFAULT_TAX_SETTINGS).length).toBe(0)
  })
})

describe('computeSettingsWarnings', () => {
  it('returns no warnings for the untouched engine defaults', () => {
    expect(computeSettingsWarnings(DEFAULT_ASSUMPTION_SETTINGS)).toEqual([])
  })

  it('flags each zeroed fee independently', () => {
    const warnings = computeSettingsWarnings({ ...DEFAULT_ASSUMPTION_SETTINGS, default_arrangement_fee: 0 })
    expect(warnings.map(w => w.field)).toEqual(['default_arrangement_fee'])
  })

  it('flags capex_cost_per_property: 0', () => {
    const warnings = computeSettingsWarnings({ ...DEFAULT_ASSUMPTION_SETTINGS, capex_cost_per_property: 0 })
    expect(warnings.some(w => w.field === 'capex_cost_per_property')).toBe(true)
  })

  it('flags multiple zeroed fields at once', () => {
    const warnings = computeSettingsWarnings({
      ...DEFAULT_ASSUMPTION_SETTINGS,
      default_arrangement_fee: 0,
      default_valuation_fee: 0,
      default_legal_fees: 0,
      capex_cost_per_property: 0,
    })
    expect(warnings.length).toBe(4)
  })
})
