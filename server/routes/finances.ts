import { Router } from 'express'
import { queryAll, queryOne, execute } from '../db/database.ts'
import { logActivity } from '../services/activityLogger.ts'

const router = Router()

router.get('/summary', (_req, res) => {
  try {
    const currentYear = new Date().getFullYear()
    const ytdStart = `${currentYear}-01-01`

    const ytdPaid = queryOne<{ total: number }>(
      `SELECT COALESCE(SUM(amount), 0) as total FROM rent_payments
       WHERE status IN ('paid', 'late') AND due_date >= ?`, [ytdStart]
    )
    // Fall back to expected income (active tenant rents × months elapsed) when no payment records exist
    const activeRents = queryAll<{ rent_amount: number }>(
      `SELECT rent_amount FROM tenants WHERE status = 'active'`
    )
    const monthlyExpected = activeRents.reduce((s: number, t: { rent_amount: number }) => s + t.rent_amount, 0)
    const monthsElapsed = new Date().getMonth() + 1
    const ytdIncome = { total: (ytdPaid?.total ?? 0) > 0 ? (ytdPaid?.total ?? 0) : monthlyExpected * monthsElapsed }
    const ytdExpenses = queryOne<{ total: number }>(
      `SELECT COALESCE(SUM(CASE
          WHEN frequency='monthly' THEN amount
          WHEN frequency='quarterly' THEN amount / 3.0
          WHEN frequency='annually' THEN amount / 12.0
          ELSE 0 END), 0) as total
       FROM expenses WHERE active=1`
    )

    const mortgagePayments = queryOne<{ total: number }>(
      `SELECT COALESCE(SUM(monthly_payment), 0) as total FROM mortgages WHERE is_active = 1`
    )
    const monthlyMortgage = mortgagePayments?.total ?? 0

    const expenseCats = queryAll<{ category: string; total: number }>(
      `SELECT category, ROUND(SUM(CASE
          WHEN frequency='monthly' THEN amount
          WHEN frequency='quarterly' THEN amount/3.0
          WHEN frequency='annually' THEN amount/12.0
          ELSE 0 END), 2) as total
       FROM expenses WHERE active=1
       GROUP BY category ORDER BY total DESC`
    )
    const expenseByCategory = monthlyMortgage > 0
      ? [...expenseCats, { category: 'mortgage', total: Math.round(monthlyMortgage) }].sort((a, b) => b.total - a.total)
      : expenseCats

    const incomeByProperty = queryAll<{ property_id: number; address: string; monthly_rent: number; current_value: number }>(
      `SELECT p.id as property_id,
        (p.address_line1 || ', ' || p.town) as address,
        COALESCE(t.rent_amount, 0) as monthly_rent,
        COALESCE(p.current_value, p.purchase_price, 0) as current_value
       FROM properties p
       LEFT JOIN tenants t ON t.property_id=p.id AND t.status='active'
       ORDER BY monthly_rent DESC`
    )

    const paymentRows = queryAll<{ month: string; income: number }>(
      `SELECT strftime('%Y-%m', due_date) as month, SUM(amount) as income
       FROM rent_payments
       WHERE due_date >= date('now', '-12 months')
         AND status IN ('paid', 'pending', 'late')
       GROUP BY month ORDER BY month`
    )
    const activeTenantRents = queryAll<{ rent_amount: number }>(
      `SELECT rent_amount FROM tenants WHERE status = 'active'`
    )
    const expectedMonthly = activeTenantRents.reduce((s: number, t: { rent_amount: number }) => s + t.rent_amount, 0)
    const paymentMap = new Map(paymentRows.map(r => [r.month, r.income]))
    const now = new Date()
    const monthly = Array.from({ length: 12 }, (_, idx) => {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11 + idx, 1))
      const monthKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
      const income = paymentMap.get(monthKey) ?? expectedMonthly
      return { month: monthKey, income, expenses: 0, net: Math.round(income - (ytdExpenses?.total ?? 0) - monthlyMortgage) }
    })

    const ytdNet = (ytdIncome?.total ?? 0)
      - ((ytdExpenses?.total ?? 0) * monthsElapsed)
      - (monthlyMortgage * monthsElapsed)

    res.json({
      ytd_income: ytdIncome?.total ?? 0,
      ytd_expenses_monthly_rate: ytdExpenses?.total ?? 0,
      ytd_monthly_mortgage: Math.round(monthlyMortgage),
      ytd_net: Math.round(ytdNet),
      expense_by_category: expenseByCategory,
      income_by_property: incomeByProperty.map(p => ({
        ...p,
        gross_yield: p.current_value > 0 ? Math.round((p.monthly_rent * 12 / p.current_value) * 1000) / 10 : 0,
      })),
      monthly_chart: monthly,
    })
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

// Expenses CRUD
router.get('/expenses', (_req, res) => {
  try {
    const expenses = queryAll(
      `SELECT e.*, COALESCE(p.address_line1 || ', ' || p.town, 'Portfolio-wide') as property_address
       FROM expenses e
       LEFT JOIN properties p ON p.id=e.property_id
       ORDER BY e.active DESC, e.category`
    )
    res.json(expenses)
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.post('/expenses', (req, res) => {
  try {
    const d = req.body
    const result = execute(
      `INSERT INTO expenses (property_id, category, amount, frequency, description, start_date, end_date, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [d.property_id || null, d.category, d.amount, d.frequency ?? 'monthly', d.description ?? null,
       d.start_date ?? null, d.end_date ?? null, d.active ?? 1]
    )
    res.status(201).json(queryOne('SELECT * FROM expenses WHERE id = ?', [result.lastInsertRowid]))
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.put('/expenses/:id', (req, res) => {
  try {
    const id = Number(req.params.id)
    const d = req.body
    execute(
      `UPDATE expenses SET property_id=?, category=?, amount=?, frequency=?, description=?,
        start_date=?, end_date=?, active=? WHERE id=?`,
      [d.property_id || null, d.category, d.amount, d.frequency, d.description ?? null,
       d.start_date ?? null, d.end_date ?? null, d.active ?? 1, id]
    )
    res.json(queryOne('SELECT * FROM expenses WHERE id = ?', [id]))
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.delete('/expenses/:id', (req, res) => {
  try {
    execute('DELETE FROM expenses WHERE id = ?', [Number(req.params.id)])
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

// Rent payments
router.get('/rent-payments', (req, res) => {
  try {
    const { property_id, status } = req.query
    let sql = `SELECT rp.*, t.name as tenant_name, p.address_line1, p.town
               FROM rent_payments rp
               LEFT JOIN tenants t ON t.id=rp.tenant_id
               JOIN properties p ON p.id=rp.property_id
               WHERE 1=1`
    const params: unknown[] = []
    if (property_id) { sql += ' AND rp.property_id=?'; params.push(property_id) }
    if (status) { sql += ' AND rp.status=?'; params.push(status) }
    sql += ' ORDER BY rp.due_date DESC LIMIT 100'
    res.json(queryAll(sql, params))
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.post('/rent-payments', (req, res) => {
  try {
    const d = req.body
    const result = execute(
      `INSERT INTO rent_payments (property_id, tenant_id, amount, due_date, paid_date, payment_method, reference, notes, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [d.property_id, d.tenant_id ?? null, d.amount, d.due_date,
       d.paid_date ?? null, d.payment_method ?? 'bank_transfer',
       d.reference ?? null, d.notes ?? null, d.status ?? 'pending']
    )
    if (d.status === 'paid') {
      const tenant = queryOne<{ name: string }>('SELECT name FROM tenants WHERE id=?', [d.tenant_id])
      logActivity('rent_received', 'payment', Number(result.lastInsertRowid), `Rent received: £${d.amount} from ${tenant?.name ?? 'tenant'}`)
    }
    res.status(201).json(queryOne('SELECT * FROM rent_payments WHERE id=?', [result.lastInsertRowid]))
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.put('/rent-payments/:id', (req, res) => {
  try {
    const id = Number(req.params.id)
    const d = req.body
    execute(
      `UPDATE rent_payments SET amount=?, due_date=?, paid_date=?, payment_method=?,
        reference=?, notes=?, status=? WHERE id=?`,
      [d.amount, d.due_date, d.paid_date ?? null, d.payment_method ?? 'bank_transfer',
       d.reference ?? null, d.notes ?? null, d.status, id]
    )
    if (d.status === 'paid') {
      logActivity('rent_received', 'payment', id, `Rent payment marked as paid: £${d.amount}`)
    }
    res.json(queryOne('SELECT * FROM rent_payments WHERE id=?', [id]))
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

export default router
