import { Router } from 'express'
import { queryAll, queryOne, execute } from '../db/database.ts'
import { calculateAcquisitionMetrics } from '../services/calculations.ts'
import { logActivity } from '../services/activityLogger.ts'

const router = Router()

function enrichWithMetrics(opp: Record<string, unknown>) {
  const metrics = calculateAcquisitionMetrics({
    asking_price: opp.asking_price as number,
    estimated_value: opp.estimated_value as number,
    expected_rent: opp.expected_rent as number,
    repair_costs: opp.repair_costs as number,
    deposit_percent: opp.deposit_percent as number,
    mortgage_rate: opp.mortgage_rate as number,
  })
  return { ...opp, metrics }
}

router.get('/', (_req, res) => {
  try {
    const opps = queryAll<Record<string, unknown>>('SELECT * FROM acquisition_opportunities ORDER BY updated_at DESC')
    res.json(opps.map(enrichWithMetrics))
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.get('/:id', (req, res) => {
  try {
    const id = Number(req.params.id)
    const opp = queryOne<Record<string, unknown>>('SELECT * FROM acquisition_opportunities WHERE id=?', [id])
    if (!opp) return res.status(404).json({ message: 'Not found' })
    const sales = queryAll('SELECT * FROM comparable_sales WHERE opportunity_id=?', [id])
    const rentals = queryAll('SELECT * FROM comparable_rentals WHERE opportunity_id=?', [id])
    res.json({ ...enrichWithMetrics(opp), comparable_sales: sales, comparable_rentals: rentals })
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.post('/', (req, res) => {
  try {
    const d = req.body
    const result = execute(
      `INSERT INTO acquisition_opportunities (address, town, postcode, stage, property_type, bedrooms,
        asking_price, estimated_value, expected_rent, repair_costs, deposit_percent, mortgage_rate,
        notes, agent_name, agent_phone, agent_email, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [d.address, d.town ?? null, d.postcode ?? null, d.stage ?? 'spotted',
       d.property_type ?? 'house', d.bedrooms ?? null, d.asking_price ?? null,
       d.estimated_value ?? null, d.expected_rent ?? null, d.repair_costs ?? 0,
       d.deposit_percent ?? 25, d.mortgage_rate ?? 5.5, d.notes ?? null,
       d.agent_name ?? null, d.agent_phone ?? null, d.agent_email ?? null, d.source ?? null]
    )
    logActivity('opportunity_added', 'acquisition', Number(result.lastInsertRowid), `Opportunity added: ${d.address}`)
    const opp = queryOne<Record<string, unknown>>('SELECT * FROM acquisition_opportunities WHERE id=?', [result.lastInsertRowid])
    res.status(201).json(enrichWithMetrics(opp!))
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.put('/:id', (req, res) => {
  try {
    const id = Number(req.params.id)
    const d = req.body
    execute(
      `UPDATE acquisition_opportunities SET address=?, town=?, postcode=?, stage=?, property_type=?,
        bedrooms=?, asking_price=?, estimated_value=?, expected_rent=?, repair_costs=?,
        deposit_percent=?, mortgage_rate=?, notes=?, agent_name=?, agent_phone=?,
        agent_email=?, source=?, updated_at=datetime('now')
       WHERE id=?`,
      [d.address, d.town ?? null, d.postcode ?? null, d.stage, d.property_type,
       d.bedrooms ?? null, d.asking_price ?? null, d.estimated_value ?? null,
       d.expected_rent ?? null, d.repair_costs ?? 0, d.deposit_percent ?? 25,
       d.mortgage_rate ?? 5.5, d.notes ?? null, d.agent_name ?? null,
       d.agent_phone ?? null, d.agent_email ?? null, d.source ?? null, id]
    )
    const opp = queryOne<Record<string, unknown>>('SELECT * FROM acquisition_opportunities WHERE id=?', [id])
    res.json(enrichWithMetrics(opp!))
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.patch('/:id/stage', (req, res) => {
  try {
    const id = Number(req.params.id)
    const { stage } = req.body
    execute("UPDATE acquisition_opportunities SET stage=?, updated_at=datetime('now') WHERE id=?", [stage, id])
    logActivity('opportunity_stage_changed', 'acquisition', id, `Pipeline stage updated to: ${stage}`)
    res.json({ success: true, stage })
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.delete('/:id', (req, res) => {
  try {
    execute('DELETE FROM acquisition_opportunities WHERE id=?', [Number(req.params.id)])
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.post('/:id/comparables/sales', (req, res) => {
  try {
    const d = req.body
    const result = execute(
      'INSERT INTO comparable_sales (opportunity_id, address, sale_price, sale_date, bedrooms, property_type, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [req.params.id, d.address, d.sale_price, d.sale_date ?? null, d.bedrooms ?? null, d.property_type ?? null, d.notes ?? null]
    )
    res.status(201).json(queryOne('SELECT * FROM comparable_sales WHERE id=?', [result.lastInsertRowid]))
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.post('/:id/comparables/rentals', (req, res) => {
  try {
    const d = req.body
    const result = execute(
      'INSERT INTO comparable_rentals (opportunity_id, address, rent_amount, bedrooms, property_type, notes) VALUES (?, ?, ?, ?, ?, ?)',
      [req.params.id, d.address, d.rent_amount, d.bedrooms ?? null, d.property_type ?? null, d.notes ?? null]
    )
    res.status(201).json(queryOne('SELECT * FROM comparable_rentals WHERE id=?', [result.lastInsertRowid]))
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.delete('/comparables/sales/:id', (req, res) => {
  try {
    execute('DELETE FROM comparable_sales WHERE id=?', [Number(req.params.id)])
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.delete('/comparables/rentals/:id', (req, res) => {
  try {
    execute('DELETE FROM comparable_rentals WHERE id=?', [Number(req.params.id)])
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

export default router
