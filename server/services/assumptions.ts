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
  capex_cycle_years: number               // e.g. 10 (lumpy capex — boiler/roof/kitchens — recurs every N years/property)
  capex_cost_per_property: number         // e.g. 3000 (£ charged per property at each capex cycle)
  arrears_pct: number                     // e.g. 1.5 (rent arrears/bad debt, distinct from void)
  default_completion_lag_months: number   // e.g. 2 (offer-to-completion delay; §P1-6 transaction-timing)
  default_onboarding_void_months: number  // e.g. 1 (no-rent re-letting/works period post-completion; §P1-6 transaction-timing)
  low_risk_hold_max_mortgages: number     // e.g. 2 (concurrent mortgages the Low-Risk Hold strategy holds before de-gearing)
  medium_risk_hold_max_mortgages: number  // e.g. 3 (same, for the Medium-Risk Hold variant)
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
  capex_cycle_years: 10,
  capex_cost_per_property: 3000,
  arrears_pct: 1.5,
  default_completion_lag_months: 2,
  default_onboarding_void_months: 1,
  low_risk_hold_max_mortgages: 2,
  medium_risk_hold_max_mortgages: 3,
}
