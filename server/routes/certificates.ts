import { Router } from 'express'
import { queryAll, queryOne, execute } from '../db/database.ts'
import { logActivity } from '../services/activityLogger.ts'

const router = Router()

function computeStatus(expiryDate: string): 'expired' | 'due_soon' | 'valid' {
  const days = Math.ceil((new Date(expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
  if (days < 0) return 'expired'
  if (days <= 60) return 'due_soon'
  return 'valid'
}

router.get('/', (req, res) => {
  try {
    const { property_id } = req.query
    let sql = `SELECT c.*, p.address_line1, p.town FROM certificates c
               JOIN properties p ON p.id=c.property_id WHERE 1=1`
    const params: unknown[] = []
    if (property_id) { sql += ' AND c.property_id=?'; params.push(property_id) }
    sql += ' ORDER BY c.expiry_date'
    const certs = queryAll<Record<string, unknown>>(sql, params)
    res.json(certs.map(c => ({ ...c, computed_status: computeStatus(c.expiry_date as string) })))
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.get('/upcoming', (_req, res) => {
  try {
    const certs = queryAll<Record<string, unknown>>(
      `SELECT c.*, p.address_line1, p.town
       FROM certificates c
       JOIN properties p ON p.id=c.property_id
       ORDER BY c.expiry_date`
    )
    const enriched = certs.map(c => ({ ...c, computed_status: computeStatus(c.expiry_date as string) }))
    res.json({
      expired: enriched.filter(c => c.computed_status === 'expired'),
      due_soon: enriched.filter(c => c.computed_status === 'due_soon'),
      valid: enriched.filter(c => c.computed_status === 'valid'),
      all: enriched,
    })
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.post('/', (req, res) => {
  try {
    const d = req.body
    const result = execute(
      `INSERT INTO certificates (property_id, type, issue_date, expiry_date, issuer, file_path, notes, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [d.property_id, d.type, d.issue_date ?? null, d.expiry_date,
       d.issuer ?? null, d.file_path ?? null, d.notes ?? null,
       computeStatus(d.expiry_date)]
    )
    logActivity('certificate_added', 'certificate', Number(result.lastInsertRowid), `Certificate added: ${d.type.replace(/_/g,' ')}`)
    res.status(201).json(queryOne('SELECT * FROM certificates WHERE id=?', [result.lastInsertRowid]))
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.put('/:id', (req, res) => {
  try {
    const id = Number(req.params.id)
    const d = req.body
    execute(
      `UPDATE certificates SET type=?, issue_date=?, expiry_date=?, issuer=?, file_path=?,
        notes=?, status=?, updated_at=datetime('now') WHERE id=?`,
      [d.type, d.issue_date ?? null, d.expiry_date, d.issuer ?? null,
       d.file_path ?? null, d.notes ?? null, computeStatus(d.expiry_date), id]
    )
    res.json(queryOne('SELECT * FROM certificates WHERE id=?', [id]))
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.delete('/:id', (req, res) => {
  try {
    execute('DELETE FROM certificates WHERE id=?', [Number(req.params.id)])
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

export default router
