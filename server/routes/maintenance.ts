import { Router } from 'express'
import { queryAll, queryOne, execute } from '../db/database.ts'
import { logActivity } from '../services/activityLogger.ts'

const router = Router()

router.get('/', (req, res) => {
  try {
    const { property_id, status } = req.query
    let sql = `SELECT m.*, p.address_line1, p.town FROM maintenance_records m
               JOIN properties p ON p.id=m.property_id WHERE 1=1`
    const params: unknown[] = []
    if (property_id) { sql += ' AND m.property_id=?'; params.push(property_id) }
    if (status) { sql += ' AND m.status=?'; params.push(status) }
    sql += ' ORDER BY m.date DESC'
    res.json(queryAll(sql, params))
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.post('/', (req, res) => {
  try {
    const d = req.body
    const result = execute(
      `INSERT INTO maintenance_records (property_id, title, description, category, cost, date, contractor, contractor_phone, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [d.property_id, d.title, d.description ?? null, d.category ?? 'other',
       d.cost ?? 0, d.date, d.contractor ?? null, d.contractor_phone ?? null,
       d.status ?? 'pending', d.notes ?? null]
    )
    logActivity('maintenance_logged', 'maintenance', Number(result.lastInsertRowid), `Maintenance logged: ${d.title}`)
    res.status(201).json(queryOne('SELECT * FROM maintenance_records WHERE id=?', [result.lastInsertRowid]))
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.put('/:id', (req, res) => {
  try {
    const id = Number(req.params.id)
    const d = req.body
    execute(
      `UPDATE maintenance_records SET title=?, description=?, category=?, cost=?, date=?,
        contractor=?, contractor_phone=?, status=?, notes=?, updated_at=datetime('now')
       WHERE id=?`,
      [d.title, d.description ?? null, d.category, d.cost ?? 0, d.date,
       d.contractor ?? null, d.contractor_phone ?? null, d.status, d.notes ?? null, id]
    )
    if (d.status === 'completed') {
      logActivity('maintenance_completed', 'maintenance', id, `Maintenance completed: ${d.title}`)
    }
    res.json(queryOne('SELECT * FROM maintenance_records WHERE id=?', [id]))
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.delete('/:id', (req, res) => {
  try {
    execute('DELETE FROM maintenance_records WHERE id=?', [Number(req.params.id)])
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

export default router
