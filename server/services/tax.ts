// UK tax model for post-tax cashflow (Epic C4).
//
// Deliberately simplified for a single-investor FI-planning tool:
//  - Income tax is approximated monthly (annual figures ÷ 12 behave identically
//    here since rates are flat), with no loss carry-forward between months.
//  - Personal: a single marginal rate plus the Section-24 basic-rate credit on
//    mortgage interest (personal allowance assumed used by other income).
//  - Ltd: modelled to the corporation-tax line only (profit retained in the
//    company); no dividend extraction.
//  - CGT annual exemption is applied per disposal.

export interface TaxSettings {
  ownership: 'personal' | 'ltd'
  personal_marginal_rate_pct: number   // e.g. 40
  s24_credit_rate_pct: number          // e.g. 20 (basic-rate interest credit)
  corp_tax_rate_pct: number            // e.g. 19
  cgt_rate_pct: number                 // e.g. 24 (residential higher rate)
  cgt_annual_exempt: number            // e.g. 3000
  selling_costs_pct: number            // e.g. 2 (agent + legal on disposal)
}

export const DEFAULT_TAX_SETTINGS: TaxSettings = {
  ownership: 'personal',
  personal_marginal_rate_pct: 40,
  s24_credit_rate_pct: 20,
  corp_tax_rate_pct: 19,
  cgt_rate_pct: 24,
  cgt_annual_exempt: 3000,
  selling_costs_pct: 2,
}

export interface IncomeInputs {
  rent: number       // gross rent received in the period
  expenses: number   // allowable running costs (excl. mortgage)
  interest: number    // mortgage interest portion (excl. principal)
}

// Income tax for a period given portfolio-level aggregates. Returns >= 0.
export function incomeTaxForMonth(t: TaxSettings, { rent, expenses, interest }: IncomeInputs): number {
  if (t.ownership === 'ltd') {
    // Interest is fully deductible for a company.
    const profit = rent - expenses - interest
    return Math.max(0, profit) * (t.corp_tax_rate_pct / 100)
  }
  // Personal (S24): interest is NOT deductible; instead a basic-rate tax credit.
  const profit = rent - expenses
  const taxOnProfit = Math.max(0, profit) * (t.personal_marginal_rate_pct / 100)
  // Credit = creditRate × min(finance costs, property profit) — HMRC cap.
  const creditBase = Math.min(Math.max(0, interest), Math.max(0, profit))
  const credit = creditBase * (t.s24_credit_rate_pct / 100)
  return Math.max(0, taxOnProfit - credit)
}

// Lender ICR stress-test floor (P0 #4). Real BTL lenders require 125% cover for a
// personal basic-rate landlord, 145% for higher-rate personal or a Ltd company —
// derived from the same TaxSettings already flowing through the engine so there is
// one canonical threshold, not a number re-guessed in three different places.
export function icrThresholdPct(t?: TaxSettings): number {
  if (!t) return 125
  return t.ownership === 'ltd' || t.personal_marginal_rate_pct >= 40 ? 145 : 125
}

export interface DisposalInputs {
  saleValue: number    // gross sale price
  costBasis: number    // original purchase price (+ acquisition costs)
  sellingCosts?: number // optional override; otherwise derived from selling_costs_pct
}

// Tax due on a disposal plus the pre-tax proceeds (before debt repayment).
export function disposalTax(
  t: TaxSettings,
  { saleValue, costBasis, sellingCosts }: DisposalInputs
): { cgt: number; sellingCosts: number; gain: number; netProceedsPreTax: number } {
  const costs = sellingCosts ?? saleValue * (t.selling_costs_pct / 100)
  const gain = saleValue - costs - costBasis
  const cgt = t.ownership === 'ltd'
    ? Math.max(0, gain) * (t.corp_tax_rate_pct / 100)             // gain taxed via corp tax
    : Math.max(0, gain - t.cgt_annual_exempt) * (t.cgt_rate_pct / 100)
  return { cgt, sellingCosts: costs, gain, netProceedsPreTax: saleValue - costs }
}
