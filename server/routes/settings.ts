import { Router } from 'express'
import { getSettings, updateSettings, type Settings } from '../services/settings.ts'
import { DEFAULT_TAX_SETTINGS } from '../services/tax.ts'

const router = Router()

router.get('/', (_req, res) => {
  try {
    res.json(getSettings())
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.put('/', (req, res) => {
  try {
    const d = req.body as Partial<Settings>
    const current = getSettings()
    // Merge over current so partial updates are safe
    const next: Settings = {
      ownership: d.ownership ?? current.ownership,
      personal_marginal_rate_pct: d.personal_marginal_rate_pct ?? current.personal_marginal_rate_pct,
      s24_credit_rate_pct: d.s24_credit_rate_pct ?? current.s24_credit_rate_pct,
      corp_tax_rate_pct: d.corp_tax_rate_pct ?? current.corp_tax_rate_pct,
      cgt_rate_pct: d.cgt_rate_pct ?? current.cgt_rate_pct,
      cgt_annual_exempt: d.cgt_annual_exempt ?? current.cgt_annual_exempt,
      selling_costs_pct: d.selling_costs_pct ?? current.selling_costs_pct,
      default_deposit_percent: d.default_deposit_percent ?? current.default_deposit_percent,
      default_mortgage_rate_pct: d.default_mortgage_rate_pct ?? current.default_mortgage_rate_pct,
      default_legal_fees: d.default_legal_fees ?? current.default_legal_fees,
      default_arrangement_fee: d.default_arrangement_fee ?? current.default_arrangement_fee,
      default_valuation_fee: d.default_valuation_fee ?? current.default_valuation_fee,
      default_property_growth_pct: d.default_property_growth_pct ?? current.default_property_growth_pct,
      default_rent_growth_pct: d.default_rent_growth_pct ?? current.default_rent_growth_pct,
      default_expense_inflation_pct: d.default_expense_inflation_pct ?? current.default_expense_inflation_pct,
      default_void_months_per_year: d.default_void_months_per_year ?? current.default_void_months_per_year,
      icr_stress_uplift_bps: d.icr_stress_uplift_bps ?? current.icr_stress_uplift_bps,
      icr_stress_floor_pct: d.icr_stress_floor_pct ?? current.icr_stress_floor_pct,
      capex_cycle_years: d.capex_cycle_years ?? current.capex_cycle_years,
      capex_cost_per_property: d.capex_cost_per_property ?? current.capex_cost_per_property,
      arrears_pct: d.arrears_pct ?? current.arrears_pct,
    }
    if (next.ownership !== 'personal' && next.ownership !== 'ltd') {
      next.ownership = DEFAULT_TAX_SETTINGS.ownership
    }
    res.json(updateSettings(next))
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

export default router
