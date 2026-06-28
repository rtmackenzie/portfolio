import { Router } from 'express'
import { queryAll, queryOne, execute } from '../db/database.ts'
import { logActivity } from '../services/activityLogger.ts'

const router = Router()

const GOAL_SELECT = `
  SELECT g.*, s.name as scenario_name
  FROM goals g
  LEFT JOIN scenarios s ON s.id = g.scenario_id
`

router.get('/', (_req, res) => {
  try {
    res.json(queryAll(GOAL_SELECT + 'ORDER BY g.created_at DESC'))
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.get('/:id', (req, res) => {
  try {
    const id = Number(req.params.id)
    const goal = queryOne(GOAL_SELECT + 'WHERE g.id = ?', [id])
    if (!goal) return res.status(404).json({ message: 'Not found' })
    res.json(goal)
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.post('/', (req, res) => {
  try {
    const d = req.body
    const result = execute(
      `INSERT INTO goals (name, goal_type, target_monthly_income, target_property_count, target_equity,
        target_date, max_ltv_pct, min_dscr, min_annual_cashflow, scenario_id, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [d.name, d.goal_type,
       d.target_monthly_income ?? null, d.target_property_count ?? null,
       d.target_equity ?? null, d.target_date ?? null,
       d.max_ltv_pct ?? null, d.min_dscr ?? null, d.min_annual_cashflow ?? null,
       d.scenario_id ?? null, d.notes ?? null]
    )
    const goal = queryOne(GOAL_SELECT + 'WHERE g.id = ?', [result.lastInsertRowid])
    logActivity('goal_created', 'goal', Number(result.lastInsertRowid), `Goal created: ${d.name}`)
    res.status(201).json(goal)
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.put('/:id', (req, res) => {
  try {
    const id = Number(req.params.id)
    const d = req.body
    execute(
      `UPDATE goals SET name=?, goal_type=?, target_monthly_income=?, target_property_count=?,
        target_equity=?, target_date=?, max_ltv_pct=?, min_dscr=?, min_annual_cashflow=?,
        scenario_id=?, notes=?, updated_at=datetime('now') WHERE id=?`,
      [d.name, d.goal_type,
       d.target_monthly_income ?? null, d.target_property_count ?? null,
       d.target_equity ?? null, d.target_date ?? null,
       d.max_ltv_pct ?? null, d.min_dscr ?? null, d.min_annual_cashflow ?? null,
       d.scenario_id ?? null, d.notes ?? null, id]
    )
    const goal = queryOne(GOAL_SELECT + 'WHERE g.id = ?', [id])
    if (!goal) return res.status(404).json({ message: 'Not found' })
    logActivity('goal_updated', 'goal', id, `Goal updated: ${d.name}`)
    res.json(goal)
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.delete('/:id', (req, res) => {
  try {
    const id = Number(req.params.id)
    const existing = queryOne<{ name: string }>('SELECT name FROM goals WHERE id=?', [id])
    execute('DELETE FROM goals WHERE id=?', [id])
    logActivity('goal_deleted', 'goal', id, `Goal deleted: ${existing?.name ?? id}`)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

export default router
