import { queryOne, execute } from '../db/database.ts'
import { DEFAULT_TAX_SETTINGS, type TaxSettings } from './tax.ts'

interface SettingsRow {
  tax_ownership: 'personal' | 'ltd'
  personal_marginal_rate_pct: number
  s24_credit_rate_pct: number
  corp_tax_rate_pct: number
  cgt_rate_pct: number
  cgt_annual_exempt: number
  selling_costs_pct: number
}

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

// Global, investor-wide tax settings (single row id=1). Falls back to defaults
// if the row is somehow missing.
export function loadTaxSettings(): TaxSettings {
  const row = queryOne<SettingsRow>('SELECT * FROM app_settings WHERE id = 1')
  return row ? rowToTax(row) : { ...DEFAULT_TAX_SETTINGS }
}

export function getSettings(): TaxSettings {
  return loadTaxSettings()
}

export function updateSettings(t: TaxSettings): TaxSettings {
  execute(
    `UPDATE app_settings SET
       tax_ownership=?, personal_marginal_rate_pct=?, s24_credit_rate_pct=?,
       corp_tax_rate_pct=?, cgt_rate_pct=?, cgt_annual_exempt=?, selling_costs_pct=?,
       updated_at=datetime('now')
     WHERE id = 1`,
    [t.ownership, t.personal_marginal_rate_pct, t.s24_credit_rate_pct,
     t.corp_tax_rate_pct, t.cgt_rate_pct, t.cgt_annual_exempt, t.selling_costs_pct]
  )
  return loadTaxSettings()
}
