import { describe, it, expect } from 'vitest'
import { buildDownturnAssumptions } from '../../server/services/downturn.ts'

describe('buildDownturnAssumptions', () => {
  it('overlays the fixed downturn shock values', () => {
    const central = JSON.stringify({ property_growth_pct: 3, rent_growth_pct: 2.5 })
    const result = JSON.parse(buildDownturnAssumptions(central))
    expect(result.void_months_per_year).toBe(2)
    expect(result.arrears_pct).toBe(3)
    expect(result.mortgage_reprice_uplift_bps).toBe(300)
  })

  it('builds a 24-month dip then recovers at the central case\'s own configured growth rate', () => {
    const central = JSON.stringify({ property_growth_pct: 3.5, rent_growth_pct: 2.2 })
    const result = JSON.parse(buildDownturnAssumptions(central))
    expect(result.growth_schedule).toEqual([{ months: 24, pct: -8 }, { pct: 3.5 }])
    expect(result.rent_growth_schedule).toEqual([{ months: 24, pct: 0 }, { pct: 2.2 }])
  })

  it('falls back to global settings defaults for the recovery rate when the scenario has no central rate of its own', () => {
    const central = JSON.stringify({})
    const result = JSON.parse(buildDownturnAssumptions(central, { default_property_growth_pct: 4.1, default_rent_growth_pct: 1.9 } as any))
    expect(result.growth_schedule).toEqual([{ months: 24, pct: -8 }, { pct: 4.1 }])
    expect(result.rent_growth_schedule).toEqual([{ months: 24, pct: 0 }, { pct: 1.9 }])
  })

  it('falls back to the engine literal (3.0%/2.5%) when neither the scenario nor settings specify a rate', () => {
    const result = JSON.parse(buildDownturnAssumptions(null))
    expect(result.growth_schedule).toEqual([{ months: 24, pct: -8 }, { pct: 3.0 }])
    expect(result.rent_growth_schedule).toEqual([{ months: 24, pct: 0 }, { pct: 2.5 }])
  })

  it('leaves unrelated central-case assumptions untouched', () => {
    const central = JSON.stringify({ property_growth_pct: 3, expense_inflation_pct: 2.5, capex_cost_per_property: 5000, erc_pct: 4 })
    const result = JSON.parse(buildDownturnAssumptions(central))
    expect(result.expense_inflation_pct).toBe(2.5)
    expect(result.capex_cost_per_property).toBe(5000)
    expect(result.erc_pct).toBe(4)
  })

  it('handles an undefined/empty central assumptions_json gracefully', () => {
    expect(() => buildDownturnAssumptions(undefined)).not.toThrow()
    expect(() => buildDownturnAssumptions('')).not.toThrow()
  })
})
