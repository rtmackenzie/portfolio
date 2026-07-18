import { queryAll, queryOne, NOT_SOLD, OWNED_PROPERTY_IDS } from '../db/database.ts'
import type { ScorecardInputs } from './scorecard.ts'

// Single source of portfolio facts for the scorecard (D1) and risk heatmap (D2).
export function loadScorecardInputs(): ScorecardInputs {
  return {
    properties: queryAll(
      `SELECT current_value, purchase_price, property_type, town FROM properties WHERE ${NOT_SOLD}`
    ),
    mortgages: queryAll(
      `SELECT current_balance, monthly_payment, interest_rate, type, fixed_period_end, is_active FROM mortgages
       WHERE property_id IN ${OWNED_PROPERTY_IDS}`
    ),
    tenants: queryAll(
      `SELECT status, rent_amount, tenancy_end FROM tenants WHERE property_id IN ${OWNED_PROPERTY_IDS}`
    ),
    // property_id IS NULL = a portfolio-wide expense, which survives an individual sale.
    expenses: queryAll(
      `SELECT amount, frequency, active FROM expenses
       WHERE property_id IS NULL OR property_id IN ${OWNED_PROPERTY_IDS}`
    ),
    certificates: queryAll(
      `SELECT expiry_date FROM certificates WHERE property_id IN ${OWNED_PROPERTY_IDS}`
    ),
    openMaintenance: queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM maintenance_records WHERE status IN ('pending','in_progress')`
    )?.count ?? 0,
    rentPayments: queryAll(
      `SELECT status FROM rent_payments WHERE due_date >= date('now', '-12 months')`
    ),
    opportunities: queryAll(
      'SELECT stage, asking_price, estimated_value, expected_rent, repair_costs, deposit_percent, mortgage_rate FROM acquisition_opportunities'
    ),
  }
}
