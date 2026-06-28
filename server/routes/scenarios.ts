import { Router } from 'express'
import { queryAll, queryOne, execute, transaction } from '../db/database.ts'
import { runScenario } from '../services/scenarioEngine.ts'

const router = Router()

router.get('/', (_req, res) => {
  try {
    res.json(queryAll('SELECT * FROM scenarios ORDER BY updated_at DESC'))
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.get('/:id', (req, res) => {
  try {
    const id = Number(req.params.id)
    const scenario = queryOne('SELECT * FROM scenarios WHERE id=?', [id])
    if (!scenario) return res.status(404).json({ message: 'Not found' })
    const events = queryAll('SELECT * FROM scenario_events WHERE scenario_id=? ORDER BY date, sort_order', [id])
    const results = queryOne<{ results_json: string }>('SELECT results_json FROM scenario_results WHERE scenario_id=? ORDER BY calculated_at DESC LIMIT 1', [id])
    res.json({
      ...scenario,
      events,
      results: results ? JSON.parse(results.results_json) : null,
    })
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.post('/', (req, res) => {
  try {
    const d = req.body
    const result = execute(
      'INSERT INTO scenarios (name, description, base_date, projection_years, assumptions_json) VALUES (?, ?, ?, ?, ?)',
      [d.name, d.description ?? null, d.base_date, d.projection_years ?? 10, d.assumptions_json ?? null]
    )
    res.status(201).json(queryOne('SELECT * FROM scenarios WHERE id=?', [result.lastInsertRowid]))
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.put('/:id', (req, res) => {
  try {
    const id = Number(req.params.id)
    const d = req.body
    execute(
      "UPDATE scenarios SET name=?, description=?, base_date=?, projection_years=?, assumptions_json=?, updated_at=datetime('now') WHERE id=?",
      [d.name, d.description ?? null, d.base_date, d.projection_years ?? 10, d.assumptions_json ?? null, id]
    )
    res.json(queryOne('SELECT * FROM scenarios WHERE id=?', [id]))
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.delete('/:id', (req, res) => {
  try {
    execute('DELETE FROM scenarios WHERE id=?', [Number(req.params.id)])
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.post('/:id/duplicate', (req, res) => {
  try {
    const srcId = Number(req.params.id)
    const src = queryOne<{ name: string; description: string | null; base_date: string; projection_years: number; assumptions_json: string | null }>(
      'SELECT name, description, base_date, projection_years, assumptions_json FROM scenarios WHERE id=?', [srcId]
    )
    if (!src) return res.status(404).json({ message: 'Not found' })

    const srcEvents = queryAll<{ event_type: string; property_id: number | null; date: string; parameters_json: string; sort_order: number }>(
      'SELECT event_type, property_id, date, parameters_json, sort_order FROM scenario_events WHERE scenario_id=? ORDER BY sort_order', [srcId]
    )

    let newId = 0
    transaction(() => {
      const result = execute(
        'INSERT INTO scenarios (name, description, base_date, projection_years, assumptions_json) VALUES (?, ?, ?, ?, ?)',
        [`${src.name} (copy)`, src.description, src.base_date, src.projection_years, src.assumptions_json]
      )
      newId = Number(result.lastInsertRowid)
      for (const ev of srcEvents) {
        execute(
          'INSERT INTO scenario_events (scenario_id, event_type, property_id, date, parameters_json, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
          [newId, ev.event_type, ev.property_id, ev.date, ev.parameters_json, ev.sort_order]
        )
      }
    })
    res.status(201).json(queryOne('SELECT * FROM scenarios WHERE id=?', [newId]))
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

// Events
router.post('/:id/events', (req, res) => {
  try {
    const d = req.body
    const maxOrder = queryOne<{ max_order: number | null }>(
      'SELECT MAX(sort_order) as max_order FROM scenario_events WHERE scenario_id=?',
      [req.params.id]
    )
    const result = execute(
      'INSERT INTO scenario_events (scenario_id, event_type, property_id, date, parameters_json, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
      [req.params.id, d.event_type, d.property_id ?? null, d.date,
       JSON.stringify(d.parameters ?? {}), (maxOrder?.max_order ?? -1) + 1]
    )
    res.status(201).json(queryOne('SELECT * FROM scenario_events WHERE id=?', [result.lastInsertRowid]))
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.put('/:id/events/:eid', (req, res) => {
  try {
    const d = req.body
    execute(
      'UPDATE scenario_events SET event_type=?, property_id=?, date=?, parameters_json=? WHERE id=?',
      [d.event_type, d.property_id ?? null, d.date, JSON.stringify(d.parameters ?? {}), Number(req.params.eid)]
    )
    res.json(queryOne('SELECT * FROM scenario_events WHERE id=?', [Number(req.params.eid)]))
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.delete('/:id/events/:eid', (req, res) => {
  try {
    execute('DELETE FROM scenario_events WHERE id=?', [Number(req.params.eid)])
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

// Calculate
router.post('/:id/calculate', async (req, res) => {
  try {
    const id = Number(req.params.id)
    const scenario = queryOne<{ base_date: string; projection_years: number }>('SELECT * FROM scenarios WHERE id=?', [id])
    if (!scenario) return res.status(404).json({ message: 'Not found' })
    const events = queryAll('SELECT * FROM scenario_events WHERE scenario_id=? ORDER BY date, sort_order', [id])
    const results = runScenario(scenario, events as any)
    execute('INSERT INTO scenario_results (scenario_id, results_json) VALUES (?, ?)', [id, JSON.stringify(results)])
    res.json(results)
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.get('/compare', (req, res) => {
  try {
    const ids = String(req.query.ids ?? '').split(',').map(Number).filter(Boolean)
    const results = ids.map(id => {
      const s = queryOne<{ id: number; name: string }>('SELECT id, name FROM scenarios WHERE id=?', [id])
      const r = queryOne<{ results_json: string }>('SELECT results_json FROM scenario_results WHERE scenario_id=? ORDER BY calculated_at DESC LIMIT 1', [id])
      return { scenario: s, results: r ? JSON.parse(r.results_json) : null }
    })
    res.json(results)
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

export default router
