// Concentration warnings (§P1-5b / Appendix A.2's "concentration warnings" — first review's
// #10, re-affirmed): flags when the real, held portfolio is concentrated in one town or one
// property type. Computed live from `properties`, not persisted — the same "derive, don't store"
// convention certificates.ts's computeStatus already uses.
//
// Scoped to the starting/held portfolio only: a scenario's simulated future buy_property events
// carry no address/area field (no such input exists on the event form), so concentration can't
// be computed across simulated purchases without a schema/UI addition — out of scope here.
import { queryAll, NOT_SOLD } from '../db/database.ts'

export interface ConcentrationWarning {
  field: string
  message: string
}

export interface ConcentrationProperty {
  town: string
  property_type: string
  current_value: number | null
  purchase_price: number | null
}

const TOWN_CONCENTRATION_THRESHOLD_PCT = 50
const TYPE_CONCENTRATION_THRESHOLD_PCT = 70

// Pure — takes property rows directly so it's testable without a DB. loadConcentrationWarnings()
// below is the thin DB-reading wrapper routes should call.
export function computeConcentrationWarnings(properties: ConcentrationProperty[]): ConcentrationWarning[] {
  if (properties.length === 0) return []

  const valueOf = (p: ConcentrationProperty) => p.current_value ?? p.purchase_price ?? 0
  const totalValue = properties.reduce((s, p) => s + valueOf(p), 0)
  if (totalValue <= 0) return []

  const warnings: ConcentrationWarning[] = []

  const byTown = new Map<string, number>()
  for (const p of properties) byTown.set(p.town, (byTown.get(p.town) ?? 0) + valueOf(p))
  for (const [town, value] of byTown) {
    const pct = (value / totalValue) * 100
    if (pct > TOWN_CONCENTRATION_THRESHOLD_PCT) {
      warnings.push({
        field: 'town_concentration',
        message: `${pct.toFixed(0)}% of portfolio value is in ${town} — a single local market shock (oversupply, a major employer leaving) would disproportionately affect this portfolio.`,
      })
    }
  }

  const byType = new Map<string, number>()
  for (const p of properties) byType.set(p.property_type, (byType.get(p.property_type) ?? 0) + valueOf(p))
  for (const [type, value] of byType) {
    const pct = (value / totalValue) * 100
    if (pct > TYPE_CONCENTRATION_THRESHOLD_PCT) {
      warnings.push({
        field: 'type_concentration',
        message: `${pct.toFixed(0)}% of portfolio value is ${type} stock — a regulatory or demand shift specific to this property type would disproportionately affect this portfolio.`,
      })
    }
  }

  return warnings
}

export function loadConcentrationWarnings(): ConcentrationWarning[] {
  const properties = queryAll<ConcentrationProperty>(`SELECT town, property_type, current_value, purchase_price FROM properties WHERE ${NOT_SOLD}`)
  return computeConcentrationWarnings(properties)
}
