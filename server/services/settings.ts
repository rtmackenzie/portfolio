import { queryOne, execute } from '../db/database.ts'
import { DEFAULT_TAX_SETTINGS, type TaxSettings } from './tax.ts'
import { DEFAULT_ASSUMPTION_SETTINGS, type AssumptionSettings } from './assumptions.ts'

interface SettingsRow {
  tax_ownership: 'personal' | 'ltd'
  personal_marginal_rate_pct: number
  s24_credit_rate_pct: number
  corp_tax_rate_pct: number
  cgt_rate_pct: number
  cgt_annual_exempt: number
  selling_costs_pct: number
  default_deposit_percent: number
  default_mortgage_rate_pct: number
  default_legal_fees: number
  default_arrangement_fee: number
  default_valuation_fee: number
  default_property_growth_pct: number
  default_rent_growth_pct: number
  default_expense_inflation_pct: number
  default_void_months_per_year: number
  icr_stress_uplift_bps: number
  icr_stress_floor_pct: number
}

export type Settings = TaxSettings & AssumptionSettings

function rowToTax(r: SettingsRow): TaxSettings {
  return {
    ownership: r.tax_ownership,
    personal_marginal_rate_pct: r.personal_marginal_rate_pct,
    s24_credit_rate_pct: r.s24_credit_rate_pct,
    corp_tax_rate_pct: r.corp_tax_rate_pct,
    cgt_rate_pct: r.cgt_rate_pct,
    cgt_annual_exempt: r.cgt_annual_exempt,
    selling_costs_pct: r.selling_costs_pct,
  }
}

function rowToAssumptions(r: SettingsRow): AssumptionSettings {
  return {
    default_deposit_percent: r.default_deposit_percent,
    default_mortgage_rate_pct: r.default_mortgage_rate_pct,
    default_legal_fees: r.default_legal_fees,
    default_arrangement_fee: r.default_arrangement_fee,
    default_valuation_fee: r.default_valuation_fee,
    default_property_growth_pct: r.default_property_growth_pct,
    default_rent_growth_pct: r.default_rent_growth_pct,
    default_expense_inflation_pct: r.default_expense_inflation_pct,
    default_void_months_per_year: r.default_void_months_per_year,
    icr_stress_uplift_bps: r.icr_stress_uplift_bps,
    icr_stress_floor_pct: r.icr_stress_floor_pct,
  }
}

// Global, investor-wide tax settings (single row id=1). Falls back to defaults
// if the row is somehow missing.
export function loadTaxSettings(): TaxSettings {
  const row = queryOne<SettingsRow>('SELECT * FROM app_settings WHERE id = 1')
  return row ? rowToTax(row) : { ...DEFAULT_TAX_SETTINGS }
}

// Global, investor-wide assumption defaults (single row id=1). Falls back to
// defaults if the row is somehow missing.
export function loadAssumptionSettings(): AssumptionSettings {
  const row = queryOne<SettingsRow>('SELECT * FROM app_settings WHERE id = 1')
  return row ? rowToAssumptions(row) : { ...DEFAULT_ASSUMPTION_SETTINGS }
}

export function getSettings(): Settings {
  return { ...loadTaxSettings(), ...loadAssumptionSettings() }
}

export function updateSettings(s: Settings): Settings {
  execute(
    `UPDATE app_settings SET
       tax_ownership=?, personal_marginal_rate_pct=?, s24_credit_rate_pct=?,
       corp_tax_rate_pct=?, cgt_rate_pct=?, cgt_annual_exempt=?, selling_costs_pct=?,
       default_deposit_percent=?, default_mortgage_rate_pct=?, default_legal_fees=?,
       default_arrangement_fee=?, default_valuation_fee=?, default_property_growth_pct=?,
       default_rent_growth_pct=?, default_expense_inflation_pct=?, default_void_months_per_year=?,
       icr_stress_uplift_bps=?, icr_stress_floor_pct=?,
       updated_at=datetime('now')
     WHERE id = 1`,
    [s.ownership, s.personal_marginal_rate_pct, s.s24_credit_rate_pct,
     s.corp_tax_rate_pct, s.cgt_rate_pct, s.cgt_annual_exempt, s.selling_costs_pct,
     s.default_deposit_percent, s.default_mortgage_rate_pct, s.default_legal_fees,
     s.default_arrangement_fee, s.default_valuation_fee, s.default_property_growth_pct,
     s.default_rent_growth_pct, s.default_expense_inflation_pct, s.default_void_months_per_year,
     s.icr_stress_uplift_bps, s.icr_stress_floor_pct]
  )
  return getSettings()
}
