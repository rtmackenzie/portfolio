import { Router } from 'express'
import { queryAll, queryOne, execute } from '../db/database.ts'
import { logActivity } from '../services/activityLogger.ts'

const router = Router()

router.get('/property/:propertyId', (req, res) => {
  try {
    const mortgages = queryAll('SELECT * FROM mortgages WHERE property_id = ? ORDER BY is_active DESC, created_at DESC', [req.params.propertyId])
    res.json(mortgages)
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.post('/', (req, res) => {
  try {
    const d = req.body
    if (d.is_active !== 0) {
      execute("UPDATE mortgages SET is_active=0, updated_at=datetime('now') WHERE property_id=? AND is_active=1", [d.property_id])
    }
    const result = execute(
      `INSERT INTO mortgages (property_id, lender, account_number, original_amount, current_balance,
        interest_rate, monthly_payment, type, fixed_period_end, renewal_date, start_date, is_active, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [d.property_id, d.lender, d.account_number ?? null, d.original_amount, d.current_balance,
       d.interest_rate, d.monthly_payment, d.type ?? 'fixed', d.fixed_period_end ?? null,
       d.renewal_date ?? null, d.start_date ?? null, d.is_active ?? 1, d.notes ?? null]
    )
    logActivity('mortgage_added', 'mortgage', Number(result.lastInsertRowid), `Mortgage added: ${d.lender}`)
    res.status(201).json(queryOne('SELECT * FROM mortgages WHERE id = ?', [result.lastInsertRowid]))
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.put('/:id', (req, res) => {
  try {
    const id = Number(req.params.id)
    const d = req.body
    execute(
      `UPDATE mortgages SET lender=?, account_number=?, original_amount=?, current_balance=?,
        interest_rate=?, monthly_payment=?, type=?, fixed_period_end=?, renewal_date=?,
        start_date=?, is_active=?, notes=?, updated_at=datetime('now')
       WHERE id=?`,
      [d.lender, d.account_number ?? null, d.original_amount, d.current_balance,
       d.interest_rate, d.monthly_payment, d.type, d.fixed_period_end ?? null,
       d.renewal_date ?? null, d.start_date ?? null, d.is_active ?? 1, d.notes ?? null, id]
    )
    res.json(queryOne('SELECT * FROM mortgages WHERE id = ?', [id]))
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.delete('/:id', (req, res) => {
  try {
    const id = Number(req.params.id)
    execute('DELETE FROM mortgages WHERE id = ?', [id])
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

export default router
