import { describe, it, expect } from 'vitest'
import { incomeTaxForMonth, disposalTax, DEFAULT_TAX_SETTINGS, type TaxSettings } from '../../server/services/tax.ts'

const personal: TaxSettings = { ...DEFAULT_TAX_SETTINGS, ownership: 'personal', personal_marginal_rate_pct: 40, s24_credit_rate_pct: 20 }
const ltd: TaxSettings = { ...DEFAULT_TAX_SETTINGS, ownership: 'ltd', corp_tax_rate_pct: 19 }

describe('incomeTaxForMonth — personal (S24)', () => {
  it('taxes profit (excl. interest) at the marginal rate, minus the 20% interest credit', () => {
    // rent 1000, expenses 200, interest 300 → profit (excl interest) = 800
    // tax = 800*0.40 − min(300,800)*0.20 = 320 − 60 = 260
    expect(incomeTaxForMonth(personal, { rent: 1000, expenses: 200, interest: 300 })).toBe(260)
  })

  it('never returns negative tax (credit capped at the profit base)', () => {
    // tiny profit, large interest → credit capped, tax floored at 0
    const t = incomeTaxForMonth(personal, { rent: 250, expenses: 200, interest: 5000 })
    expect(t).toBeGreaterThanOrEqual(0)
  })

  it('is zero on a loss month', () => {
    expect(incomeTaxForMonth(personal, { rent: 100, expenses: 500, interest: 100 })).toBe(0)
  })
})

describe('incomeTaxForMonth — Ltd (corporation tax)', () => {
  it('deducts interest fully then taxes at the corp rate', () => {
    // profit = 1000 − 200 − 300 = 500; tax = 500*0.19 = 95
    expect(incomeTaxForMonth(ltd, { rent: 1000, expenses: 200, interest: 300 })).toBeCloseTo(95, 6)
  })

  it('Ltd pays less than personal on the same interest-heavy let (interest deductible)', () => {
    const inputs = { rent: 1000, expenses: 200, interest: 600 }
    expect(incomeTaxForMonth(ltd, inputs)).toBeLessThan(incomeTaxForMonth(personal, inputs))
  })
})

describe('disposalTax', () => {
  it('personal CGT applies the annual exemption then the CGT rate', () => {
    // sale 300k, costs 2% = 6k, basis 200k → gain = 94k; taxable = 94k − 3k = 91k; cgt = 91k*0.24
    const { cgt, netProceedsPreTax } = disposalTax(personal, { saleValue: 300000, costBasis: 200000 })
    expect(cgt).toBeCloseTo((94000 - 3000) * 0.24, 4)
    expect(netProceedsPreTax).toBe(300000 - 6000)
  })

  it('Ltd taxes the whole gain via the corp rate (no CGT allowance)', () => {
    const { cgt } = disposalTax(ltd, { saleValue: 300000, costBasis: 200000 })
    // gain = 300k − 6k − 200k = 94k; tax = 94k*0.19
    expect(cgt).toBeCloseTo(94000 * 0.19, 4)
  })

  it('no tax on a loss-making disposal', () => {
    const { cgt } = disposalTax(personal, { saleValue: 180000, costBasis: 200000 })
    expect(cgt).toBe(0)
  })
})
