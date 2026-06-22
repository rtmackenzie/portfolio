import { Router } from 'express'
import { queryAll, queryOne, execute, transaction } from '../db/database.ts'
import { calculatePropertyFinancials } from '../services/calculations.ts'
import { logActivity } from '../services/activityLogger.ts'

const router = Router()

router.get('/', (_req, res) => {
  try {
    const properties = queryAll<Record<string, unknown>>(
      `SELECT
        p.*,
        t.id as tenant_id, t.name as tenant_name, t.rent_amount as monthly_rent,
        t.tenancy_start, t.tenancy_end, t.status as tenant_status,
        m.id as mortgage_id, m.lender, m.monthly_payment as mortgage_payment,
        m.interest_rate, m.current_balance as mortgage_balance, m.renewal_date,
        CASE WHEN p.current_value > 0 AND t.rent_amount > 0
          THEN ROUND((t.rent_amount * 12.0 / p.current_value) * 100, 2)
          ELSE NULL END as gross_yield
       FROM properties p
       LEFT JOIN tenants t ON t.property_id = p.id AND t.status = 'active'
       LEFT JOIN mortgages m ON m.property_id = p.id AND m.is_active = 1
       ORDER BY p.created_at DESC`
    )
    res.json(properties)
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.get('/:id', (req, res) => {
  try {
    const id = Number(req.params.id)
    const property = queryOne<Record<string, unknown>>('SELECT * FROM properties WHERE id = ?', [id])
    if (!property) return res.status(404).json({ message: 'Property not found' })

    const tenants = queryAll('SELECT * FROM tenants WHERE property_id = ? ORDER BY tenancy_start DESC', [id])
    const mortgages = queryAll('SELECT * FROM mortgages WHERE property_id = ? ORDER BY is_active DESC, created_at DESC', [id])
    const rentPayments = queryAll('SELECT * FROM rent_payments WHERE property_id = ? ORDER BY due_date DESC LIMIT 24', [id])
    const expenses = queryAll('SELECT * FROM expenses WHERE property_id = ? AND active = 1 ORDER BY category', [id])
    const maintenance = queryAll('SELECT * FROM maintenance_records WHERE property_id = ? ORDER BY date DESC', [id])
    const certificates = queryAll('SELECT * FROM certificates WHERE property_id = ? ORDER BY expiry_date', [id])
    const documents = queryAll('SELECT * FROM documents WHERE property_id = ? ORDER BY created_at DESC', [id])
    const valuations = queryAll('SELECT * FROM property_valuations WHERE property_id = ? ORDER BY valuation_date DESC', [id])

    const activeTenant = (tenants as { status: string; rent_amount: number }[]).find(t => t.status === 'active') ?? null
    const activeMortgage = (mortgages as { is_active: number; monthly_payment: number; current_balance: number; original_amount: number }[]).find(m => m.is_active === 1) ?? null

    const financials = calculatePropertyFinancials(
      property as { purchase_price?: number; current_value?: number },
      activeTenant,
      activeMortgage,
      (expenses as { amount: number; frequency: string }[])
    )

    res.json({ property, tenants, mortgages, rent_payments: rentPayments, expenses, maintenance, certificates, documents, valuations, financials })
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.post('/', (req, res) => {
  try {
    const d = req.body
    const result = execute(
      `INSERT INTO properties (address_line1, address_line2, town, county, postcode,
        purchase_date, purchase_price, current_value, property_type, bedrooms, bathrooms, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [d.address_line1, d.address_line2 ?? null, d.town, d.county ?? null, d.postcode,
       d.purchase_date ?? null, d.purchase_price ?? null, d.current_value ?? null,
       d.property_type ?? 'house', d.bedrooms ?? 0, d.bathrooms ?? 0, d.status ?? 'owned', d.notes ?? null]
    )
    const property = queryOne('SELECT * FROM properties WHERE id = ?', [result.lastInsertRowid])
    logActivity('property_created', 'property', Number(result.lastInsertRowid), `Property added: ${d.address_line1}, ${d.town}`)
    res.status(201).json(property)
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.put('/:id', (req, res) => {
  try {
    const id = Number(req.params.id)
    const d = req.body
    execute(
      `UPDATE properties SET address_line1=?, address_line2=?, town=?, county=?, postcode=?,
        purchase_date=?, purchase_price=?, current_value=?, property_type=?, bedrooms=?,
        bathrooms=?, status=?, notes=?, updated_at=datetime('now')
       WHERE id=?`,
      [d.address_line1, d.address_line2 ?? null, d.town, d.county ?? null, d.postcode,
       d.purchase_date ?? null, d.purchase_price ?? null, d.current_value ?? null,
       d.property_type, d.bedrooms, d.bathrooms, d.status, d.notes ?? null, id]
    )
    const property = queryOne('SELECT * FROM properties WHERE id = ?', [id])
    logActivity('property_updated', 'property', id, `Property updated: ${d.address_line1}, ${d.town}`)
    res.json(property)
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.delete('/:id', (req, res) => {
  try {
    const id = Number(req.params.id)
    const property = queryOne<{ address_line1: string; town: string }>('SELECT address_line1, town FROM properties WHERE id = ?', [id])
    execute('DELETE FROM properties WHERE id = ?', [id])
    logActivity('property_deleted', 'property', id, `Property removed: ${property?.address_line1}, ${property?.town}`)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

// Valuations sub-resource
router.post('/:id/valuations', (req, res) => {
  try {
    const propertyId = Number(req.params.id)
    const d = req.body
    const result = execute(
      'INSERT INTO property_valuations (property_id, valuation_date, amount, source, notes) VALUES (?, ?, ?, ?, ?)',
      [propertyId, d.valuation_date, d.amount, d.source ?? 'self', d.notes ?? null]
    )
    syncCurrentValue(propertyId)
    logActivity('valuation_added', 'property', propertyId, `New valuation: £${d.amount.toLocaleString()}`)
    res.status(201).json(queryOne('SELECT * FROM property_valuations WHERE id = ?', [result.lastInsertRowid]))
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.put('/:id/valuations/:vid', (req, res) => {
  try {
    const propertyId = Number(req.params.id)
    const vid = Number(req.params.vid)
    const d = req.body
    execute(
      'UPDATE property_valuations SET valuation_date = ?, amount = ?, source = ?, notes = ? WHERE id = ? AND property_id = ?',
      [d.valuation_date, d.amount, d.source ?? 'self', d.notes ?? null, vid, propertyId]
    )
    syncCurrentValue(propertyId)
    logActivity('valuation_updated', 'property', propertyId, `Valuation updated: £${d.amount.toLocaleString()}`)
    res.json(queryOne('SELECT * FROM property_valuations WHERE id = ?', [vid]))
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

function syncCurrentValue(propertyId: number) {
  const latest = queryOne<{ amount: number }>(
    'SELECT amount FROM property_valuations WHERE property_id = ? ORDER BY valuation_date DESC LIMIT 1',
    [propertyId]
  )
  if (latest) execute('UPDATE properties SET current_value = ?, updated_at = datetime(\'now\') WHERE id = ?', [latest.amount, propertyId])
}

export default router
