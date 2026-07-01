// Global, investor-wide financial assumption defaults (companion to tax.ts's
// TaxSettings). These are the "middle tier" between a per-event/per-goal override
// and the engine's own hardcoded literal fallback — see scenarioEngine.ts's
// `config.defaults` and pathwayGenerator.ts's `settings` param.

export interface AssumptionSettings {
  default_deposit_percent: number         // e.g. 25
  default_mortgage_rate_pct: number       // e.g. 5.5
  default_legal_fees: number              // e.g. 2000
  default_arrangement_fee: number         // e.g. 999
  default_valuation_fee: number           // e.g. 300
  default_property_growth_pct: number     // e.g. 3.0
  default_rent_growth_pct: number         // e.g. 2.5
  default_expense_inflation_pct: number   // e.g. 2.5
  default_void_months_per_year: number    // e.g. 1
  icr_stress_uplift_bps: number           // e.g. 200 (+2% added to pay rate for the ICR stress test)
  icr_stress_floor_pct: number            // e.g. 5.5 (stress-rate floor)
}

export const DEFAULT_ASSUMPTION_SETTINGS: AssumptionSettings = {
  default_deposit_percent: 25,
  default_mortgage_rate_pct: 5.5,
  default_legal_fees: 2000,
  default_arrangement_fee: 999,
  default_valuation_fee: 300,
  default_property_growth_pct: 3.0,
  default_rent_growth_pct: 2.5,
  default_expense_inflation_pct: 2.5,
  default_void_months_per_year: 1,
  icr_stress_uplift_bps: 200,
  icr_stress_floor_pct: 5.5,
}
