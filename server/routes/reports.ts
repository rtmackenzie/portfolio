import { Router } from 'express'
import { queryAll, queryOne } from '../db/database.ts'
import { calculatePropertyFinancials, calculatePortfolioKPIs } from '../services/calculations.ts'

const router = Router()

router.get('/portfolio-summary', (_req, res) => {
  try {
    const properties = queryAll<Record<string, unknown>>(
      `SELECT p.*,
        t.name as tenant_name, t.rent_amount, t.status as tenant_status,
        m.lender, m.current_balance, m.interest_rate, m.monthly_payment, m.renewal_date
       FROM properties p
       LEFT JOIN tenants t ON t.property_id=p.id AND t.status='active'
       LEFT JOIN mortgages m ON m.property_id=p.id AND m.is_active=1
       ORDER BY p.town, p.address_line1`
    )

    const allMortgages = queryAll<{ current_balance: number; monthly_payment: number; is_active: number }>('SELECT current_balance, monthly_payment, is_active FROM mortgages')
    const allTenants = queryAll<{ rent_amount: number; status: string }>('SELECT rent_amount, status FROM tenants')
    const allExpenses = queryAll<{ amount: number; frequency: string; active: number }>('SELECT amount, frequency, active FROM expenses')

    const kpis = calculatePortfolioKPIs(
      properties as any,
      allMortgages,
      allTenants,
      allExpenses
    )

    res.json({ properties, kpis, generated_at: new Date().toISOString() })
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

export default router
