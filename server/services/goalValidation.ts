// Prudence-warning computation (§P0-3). These inspect the *raw stored* value of a goal or
// the global assumption settings — not the value pathwayGenerator.ts resolves it to — so the
// user can see when a safety gate or cost assumption is quietly being substituted with a
// default, and when a non-zero value is unusually permissive versus real-world norms.
//
// Computed live at query time (the same "don't store what you can derive" convention
// certificates.ts's computeStatus already uses), never persisted.

import type { Goal } from './pathwayGenerator.ts'
import type { AssumptionSettings } from './assumptions.ts'
import { icrThresholdPct, type TaxSettings } from './tax.ts'

export interface PrudenceWarning {
  field: string
  message: string
}

export function computeGoalWarnings(goal: Goal, tax?: TaxSettings): PrudenceWarning[] {
  const warnings: PrudenceWarning[] = []

  if (goal.min_icr != null && goal.min_icr <= 0) {
    const fallback = icrThresholdPct(tax)
    warnings.push({
      field: 'min_icr',
      message: `Min Lender ICR is 0 — the tax-derived floor of ${fallback.toFixed(0)}% will be used instead. Leave this field blank rather than 0 if you want the default; set an explicit value ≥100% to require a stricter floor.`,
    })
  } else if (goal.min_icr != null && goal.min_icr > 0 && goal.min_icr < 100) {
    warnings.push({
      field: 'min_icr',
      message: `Min Lender ICR of ${goal.min_icr}% is well below typical lender floors (125–145%) — unusually permissive.`,
    })
  }

  if (goal.capex_reserve_per_property != null && goal.capex_reserve_per_property <= 0) {
    warnings.push({
      field: 'capex_reserve_per_property',
      message: 'Capex reserve per property is £0 — the default £1,000 float will be used instead. A £0 reserve understates real maintenance risk.',
    })
  }

  return warnings
}

export function computeSettingsWarnings(settings: AssumptionSettings): PrudenceWarning[] {
  const warnings: PrudenceWarning[] = []

  // Unlike min_icr/capex_reserve above, a fee of £0 is respected as-is, not substituted — fee-free
  // mortgage products, bundled conveyancing, and cash purchases are real cases. This is only an
  // informational nudge to confirm the zero is deliberate, not a silent-override warning.
  const feeChecks: { field: keyof AssumptionSettings; label: string; typical: string }[] = [
    { field: 'default_arrangement_fee', label: 'Arrangement fee', typical: '£500–£1,500' },
    { field: 'default_valuation_fee', label: 'Valuation fee', typical: '£150–£400' },
    { field: 'default_legal_fees', label: 'Legal fees', typical: '£1,000–£2,500' },
  ]
  for (const { field, label, typical } of feeChecks) {
    if (settings[field] === 0) {
      warnings.push({
        field,
        message: `${label} is set to £0 — this will be used as a genuine zero in every purchase. Confirm this reflects a real fee-free arrangement; typical BTL fees are ${typical}.`,
      })
    }
  }

  if (settings.capex_cost_per_property <= 0) {
    warnings.push({
      field: 'capex_cost_per_property',
      message: 'Capex cost per property is £0 — the engine default of £3,000 will be used instead. A £0 assumption understates lumpy maintenance costs (boiler/roof/kitchens) across the projection.',
    })
  }

  return warnings
}
