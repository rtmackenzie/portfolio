import { Router } from 'express'
import { queryAll, queryOne, execute } from '../db/database.ts'

const router = Router()

router.get('/property/:propertyId', (req, res) => {
  try {
    res.json(queryAll('SELECT * FROM documents WHERE property_id=? ORDER BY created_at DESC', [req.params.propertyId]))
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.post('/', (req, res) => {
  try {
    const d = req.body
    const result = execute(
      'INSERT INTO documents (property_id, name, type, file_path, expiry_date, notes) VALUES (?, ?, ?, ?, ?, ?)',
      [d.property_id ?? null, d.name, d.type ?? 'other', d.file_path ?? null, d.expiry_date ?? null, d.notes ?? null]
    )
    res.status(201).json(queryOne('SELECT * FROM documents WHERE id=?', [result.lastInsertRowid]))
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.put('/:id', (req, res) => {
  try {
    const id = Number(req.params.id)
    const d = req.body
    execute(
      'UPDATE documents SET name=?, type=?, file_path=?, expiry_date=?, notes=? WHERE id=?',
      [d.name, d.type, d.file_path ?? null, d.expiry_date ?? null, d.notes ?? null, id]
    )
    res.json(queryOne('SELECT * FROM documents WHERE id=?', [id]))
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.delete('/:id', (req, res) => {
  try {
    execute('DELETE FROM documents WHERE id=?', [Number(req.params.id)])
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

export default router
