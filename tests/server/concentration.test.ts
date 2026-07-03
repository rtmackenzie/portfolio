import { describe, it, expect } from 'vitest'
import { computeConcentrationWarnings, type ConcentrationProperty } from '../../server/services/concentration.ts'

function prop(overrides: Partial<ConcentrationProperty> = {}): ConcentrationProperty {
  return { town: 'Stockport', property_type: 'house', current_value: 100000, purchase_price: 90000, ...overrides }
}

describe('computeConcentrationWarnings', () => {
  it('returns no warnings for an empty portfolio', () => {
    expect(computeConcentrationWarnings([])).toEqual([])
  })

  it('flags a majority-in-one-town portfolio', () => {
    const properties = [
      prop({ town: 'Stockport', current_value: 300000 }),
      prop({ town: 'Stockport', current_value: 200000 }),
      prop({ town: 'Leeds', current_value: 100000 }),
    ]
    const warnings = computeConcentrationWarnings(properties)
    expect(warnings.some(w => w.field === 'town_concentration' && w.message.includes('Stockport'))).toBe(true)
  })

  it('does not flag a geographically diversified portfolio', () => {
    const properties = [
      prop({ town: 'Stockport', current_value: 100000 }),
      prop({ town: 'Leeds', current_value: 100000 }),
      prop({ town: 'Sheffield', current_value: 100000 }),
      prop({ town: 'Manchester', current_value: 100000 }),
    ]
    const warnings = computeConcentrationWarnings(properties)
    expect(warnings.some(w => w.field === 'town_concentration')).toBe(false)
  })

  it('flags a dominant single property type', () => {
    const properties = [
      prop({ property_type: 'hmo', current_value: 400000 }),
      prop({ property_type: 'hmo', current_value: 400000 }),
      prop({ property_type: 'flat', current_value: 200000 }),
    ]
    const warnings = computeConcentrationWarnings(properties)
    expect(warnings.some(w => w.field === 'type_concentration' && w.message.includes('hmo'))).toBe(true)
  })

  it('falls back to purchase_price when current_value is null', () => {
    const properties = [
      prop({ town: 'Stockport', current_value: null, purchase_price: 300000 }),
      prop({ town: 'Leeds', current_value: null, purchase_price: 50000 }),
    ]
    const warnings = computeConcentrationWarnings(properties)
    expect(warnings.some(w => w.field === 'town_concentration' && w.message.includes('Stockport'))).toBe(true)
  })

  it('does not divide by zero when every property has no value at all', () => {
    const properties = [prop({ current_value: null, purchase_price: null })]
    expect(() => computeConcentrationWarnings(properties)).not.toThrow()
    expect(computeConcentrationWarnings(properties)).toEqual([])
  })
})
