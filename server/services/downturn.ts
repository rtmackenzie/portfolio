// The downturn standing case (§P1-5 / Appendix A.1): a named, versioned, fixed parameter
// transform applied to whatever the central case already uses — not a second set of user knobs.
// Every plan is stressed identically so results are comparable across time. Recalibrate by
// bumping the id and the transform together, never by silently changing this one in place.
import type { AssumptionSettings } from './assumptions.ts'

export const DOWNTURN_2026_V1_ID = 'DOWNTURN_2026_V1'

// UK-calibrated: peak-to-trough ~16% property growth matches the 1990-92 and 2008-09
// corrections; rents flatline rather than fall; void/arrears/refix widen to the recession
// values a landlord actually feels (Appendix A.1's table).
const DOWNTURN_WINDOW_MONTHS = 24
const DOWNTURN_PROPERTY_GROWTH_PCT = -8
const DOWNTURN_RENT_GROWTH_PCT = 0
const DOWNTURN_VOID_MONTHS_PER_YEAR = 2
const DOWNTURN_ARREARS_PCT = 3
const DOWNTURN_REPRICE_UPLIFT_BPS = 300

// Overlays the fixed downturn shock on top of the scenario's own central-case assumptions —
// the recovery-phase growth rates resolve to whatever the central case actually uses (its own
// assumptions_json, falling back to global settings, falling back to the engine literal), not a
// hardcoded "3%"/"2.5%", so the downturn case tracks the central case exactly once it recovers.
export function buildDownturnAssumptions(
  centralAssumptionsJson: string | null | undefined,
  defaults?: Partial<AssumptionSettings>
): string {
  const central = JSON.parse(centralAssumptionsJson || '{}')
  const centralPropertyGrowthPct = central.property_growth_pct ?? defaults?.default_property_growth_pct ?? 3.0
  const centralRentGrowthPct = central.rent_growth_pct ?? defaults?.default_rent_growth_pct ?? 2.5

  return JSON.stringify({
    ...central,
    growth_schedule: [
      { months: DOWNTURN_WINDOW_MONTHS, pct: DOWNTURN_PROPERTY_GROWTH_PCT },
      { pct: centralPropertyGrowthPct },
    ],
    rent_growth_schedule: [
      { months: DOWNTURN_WINDOW_MONTHS, pct: DOWNTURN_RENT_GROWTH_PCT },
      { pct: centralRentGrowthPct },
    ],
    void_months_per_year: DOWNTURN_VOID_MONTHS_PER_YEAR,
    arrears_pct: DOWNTURN_ARREARS_PCT,
    mortgage_reprice_uplift_bps: DOWNTURN_REPRICE_UPLIFT_BPS,
  })
}
