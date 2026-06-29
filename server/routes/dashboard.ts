import { Router } from 'express'
import { queryAll, queryOne } from '../db/database.ts'
import { calculatePortfolioKPIs } from '../services/calculations.ts'
import { computeScorecard } from '../services/scorecard.ts'
import { computeRiskHeatmap } from '../services/risk.ts'
import { computeInsights } from '../services/insights.ts'
import { loadScorecardInputs } from '../services/portfolioFacts.ts'

const router = Router()

// Portfolio scorecard (D1) + risk heatmap (D2). Keyed under /dashboard so the
// client queries ['dashboard','scorecard'] / ['dashboard','risk'] are invalidated
// by every mutation that invalidates ['dashboard'] — recompute on change for free.
router.get('/scorecard', (_req, res) => {
  try {
    res.json(computeScorecard(loadScorecardInputs()))
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: String(err) })
  }
})

router.get('/risk', (_req, res) => {
  try {
    res.json(computeRiskHeatmap(loadScorecardInputs()))
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: String(err) })
  }
})

router.get('/insights', (_req, res) => {
  try {
    res.json(computeInsights(loadScorecardInputs()))
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: String(err) })
  }
})

router.get('/kpis', (_req, res) => {
  try {
    const properties = queryAll<{ current_value: number | null; purchase_price: number | null; id: number; status: string }>(
      'SELECT id, current_value, purchase_price, status FROM properties'
    )
    const mortgages = queryAll<{ current_balance: number; monthly_payment: number; is_active: number }>(
      'SELECT current_balance, monthly_payment, is_active FROM mortgages'
    )
    const tenants = queryAll<{ rent_amount: number; status: string }>(
      'SELECT rent_amount, status FROM tenants'
    )
    const expenses = queryAll<{ amount: number; frequency: string; active: number }>(
      'SELECT amount, frequency, active FROM expenses'
    )

    const kpis = calculatePortfolioKPIs(properties, mortgages, tenants, expenses)

    const certsExpiringSoon = queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM certificates
       WHERE date(expiry_date) <= date('now', '+60 days') AND date(expiry_date) >= date('now')`
    )
    const certsExpired = queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM certificates WHERE date(expiry_date) < date('now')`
    )
    const openMaintenance = queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM maintenance_records WHERE status IN ('pending','in_progress')`
    )

    // Income chart — last 12 months, with fallback to active tenant rents for months without payment records
    const paymentRows = queryAll<{ month: string; gross_income: number }>(
      `SELECT strftime('%Y-%m', due_date) as month, SUM(amount) as gross_income
       FROM rent_payments
       WHERE due_date >= date('now', '-12 months')
         AND status IN ('paid', 'pending', 'late')
       GROUP BY month ORDER BY month`
    )
    const activeTenants = queryAll<{ rent_amount: number }>(
      `SELECT rent_amount FROM tenants WHERE status = 'active'`
    )
    const expectedMonthly = activeTenants.reduce((s: number, t: { rent_amount: number }) => s + t.rent_amount, 0)
    const paymentMap = new Map(paymentRows.map(r => [r.month, r.gross_income]))
    const now = new Date()
    const incomeChart = Array.from({ length: 12 }, (_, idx) => {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11 + idx, 1))
      const monthKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
      return { month: monthKey, gross_income: paymentMap.get(monthKey) ?? expectedMonthly }
    })

    // Portfolio value over time — for each valuation date, sum the LATEST known value per property
    const allValuations = queryAll<{ property_id: number; valuation_date: string; amount: number }>(
      `SELECT property_id, valuation_date, amount FROM property_valuations ORDER BY valuation_date`
    )
    const valuationDates = [...new Set(allValuations.map(v => v.valuation_date))].sort()
    const valueChart = valuationDates.slice(-24).map(date => {
      const propertyValues = new Map<number, number>()
      for (const v of allValuations) {
        if (v.valuation_date <= date) propertyValues.set(v.property_id, v.amount)
      }
      return {
        valuation_date: date,
        total_value: Array.from(propertyValues.values()).reduce((s, a) => s + a, 0),
      }
    })

    // Expense breakdown by category (operating expenses + mortgage)
    const expenseCats = queryAll<{ category: string; total: number }>(
      `SELECT category,
        SUM(CASE
          WHEN frequency = 'monthly' THEN amount
          WHEN frequency = 'quarterly' THEN amount / 3.0
          WHEN frequency = 'annually' THEN amount / 12.0
          ELSE 0
        END) as total
       FROM expenses WHERE active = 1
       GROUP BY category
       ORDER BY total DESC`
    )
    const mortgageTotal = queryOne<{ total: number }>(
      `SELECT COALESCE(SUM(monthly_payment), 0) as total FROM mortgages WHERE is_active = 1`
    )
    const expenseBreakdown = (mortgageTotal?.total ?? 0) > 0
      ? [...expenseCats, { category: 'mortgage', total: Math.round(mortgageTotal?.total ?? 0) }].sort((a, b) => b.total - a.total)
      : expenseCats

    // Recent activity
    const recentActivity = queryAll(
      `SELECT * FROM activity_log ORDER BY event_date DESC LIMIT 20`
    )

    res.json({
      kpis: {
        ...kpis,
        certificates_expiring_soon: certsExpiringSoon?.count ?? 0,
        certificates_expired: certsExpired?.count ?? 0,
        maintenance_open: openMaintenance?.count ?? 0,
      },
      income_chart: incomeChart,
      value_chart: valueChart,
      expense_breakdown: expenseBreakdown,
      recent_activity: recentActivity,
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: String(err) })
  }
})

export default router
