import { Router } from 'express'
import { queryAll, queryOne, execute } from '../db/database.ts'
import { logActivity } from '../services/activityLogger.ts'

const router = Router()

router.get('/', (_req, res) => {
  try {
    const tenants = queryAll(
      `SELECT t.*, p.address_line1, p.town
       FROM tenants t
       JOIN properties p ON p.id = t.property_id
       ORDER BY t.created_at DESC`
    )
    res.json(tenants)
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.get('/property/:propertyId', (req, res) => {
  try {
    const tenants = queryAll('SELECT * FROM tenants WHERE property_id = ? ORDER BY tenancy_start DESC', [req.params.propertyId])
    res.json(tenants)
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.post('/', (req, res) => {
  try {
    const d = req.body
    // If adding an active tenant, end any existing active tenants for this property
    if (d.status === 'active' || !d.status) {
      execute("UPDATE tenants SET status='ended', updated_at=datetime('now') WHERE property_id=? AND status='active'", [d.property_id])
      execute("UPDATE properties SET status='let', updated_at=datetime('now') WHERE id=?", [d.property_id])
    }
    const result = execute(
      `INSERT INTO tenants (property_id, name, email, phone, rent_amount, rent_due_day,
        tenancy_start, tenancy_end, deposit_amount, deposit_scheme, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [d.property_id, d.name, d.email ?? null, d.phone ?? null, d.rent_amount, d.rent_due_day ?? 1,
       d.tenancy_start, d.tenancy_end ?? null, d.deposit_amount ?? null, d.deposit_scheme ?? null,
       d.status ?? 'active', d.notes ?? null]
    )
    logActivity('tenant_added', 'tenant', Number(result.lastInsertRowid), `Tenant added: ${d.name}`)
    res.status(201).json(queryOne('SELECT * FROM tenants WHERE id = ?', [result.lastInsertRowid]))
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.put('/:id', (req, res) => {
  try {
    const id = Number(req.params.id)
    const d = req.body
    execute(
      `UPDATE tenants SET name=?, email=?, phone=?, rent_amount=?, rent_due_day=?,
        tenancy_start=?, tenancy_end=?, deposit_amount=?, deposit_scheme=?,
        status=?, notes=?, updated_at=datetime('now')
       WHERE id=?`,
      [d.name, d.email ?? null, d.phone ?? null, d.rent_amount, d.rent_due_day ?? 1,
       d.tenancy_start, d.tenancy_end ?? null, d.deposit_amount ?? null, d.deposit_scheme ?? null,
       d.status, d.notes ?? null, id]
    )
    if (d.status === 'ended') {
      const tenant = queryOne<{ property_id: number }>('SELECT property_id FROM tenants WHERE id = ?', [id])
      if (tenant) execute("UPDATE properties SET status='vacant', updated_at=datetime('now') WHERE id=?", [tenant.property_id])
    }
    res.json(queryOne('SELECT * FROM tenants WHERE id = ?', [id]))
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.delete('/:id', (req, res) => {
  try {
    const id = Number(req.params.id)
    const tenant = queryOne<{ name: string }>('SELECT name FROM tenants WHERE id = ?', [id])
    execute('DELETE FROM tenants WHERE id = ?', [id])
    logActivity('tenant_removed', 'tenant', id, `Tenant removed: ${tenant?.name}`)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

export default router
