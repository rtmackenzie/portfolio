import { Router } from 'express'
import { queryAll, queryOne, execute, transaction } from '../db/database.ts'
import { logActivity } from '../services/activityLogger.ts'
import { loadPortfolioState } from '../services/scenarioEngine.ts'
import { generatePathways, type PropertyAssumptions } from '../services/pathwayGenerator.ts'

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
        target_date, max_ltv_pct, min_dscr, min_annual_cashflow, scenario_id,
        director_loan_annual, director_loan_start_date, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [d.name, d.goal_type,
       d.target_monthly_income ?? null, d.target_property_count ?? null,
       d.target_equity ?? null, d.target_date ?? null,
       d.max_ltv_pct ?? null, d.min_dscr ?? null, d.min_annual_cashflow ?? null,
       d.scenario_id ?? null,
       d.director_loan_annual ?? null, d.director_loan_start_date ?? null,
       d.notes ?? null]
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
        scenario_id=?, director_loan_annual=?, director_loan_start_date=?,
        notes=?, updated_at=datetime('now') WHERE id=?`,
      [d.name, d.goal_type,
       d.target_monthly_income ?? null, d.target_property_count ?? null,
       d.target_equity ?? null, d.target_date ?? null,
       d.max_ltv_pct ?? null, d.min_dscr ?? null, d.min_annual_cashflow ?? null,
       d.scenario_id ?? null,
       d.director_loan_annual ?? null, d.director_loan_start_date ?? null,
       d.notes ?? null, id]
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

// ─── Pathway endpoints ────────────────────────────────────────────────────────

router.get('/:id/pathways', (req, res) => {
  try {
    const id = Number(req.params.id)
    const rows = queryAll<{ summary_json: string | null; assumptions_json: string | null } & Record<string, unknown>>(
      `SELECT gp.*, s.name as scenario_name
       FROM goal_pathways gp
       LEFT JOIN scenarios s ON s.id = gp.scenario_id
       WHERE gp.goal_id = ? AND gp.scenario_id IS NOT NULL
       ORDER BY gp.created_at DESC, gp.template_name`,
      [id]
    )
    res.json(rows.map(r => ({
      ...r,
      summary: r.summary_json ? JSON.parse(r.summary_json as string) : null,
      assumptions: r.assumptions_json ? JSON.parse(r.assumptions_json as string) : null,
      summary_json: undefined,
      assumptions_json: undefined,
    })))
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.post('/:id/pathways/generate', (req, res) => {
  try {
    const id = Number(req.params.id)
    const goal = queryOne<{
      id: number; name: string; goal_type: string;
      target_monthly_income: number | null; target_property_count: number | null;
      target_equity: number | null; target_date: string | null;
      max_ltv_pct: number | null; min_dscr: number | null; min_annual_cashflow: number | null;
      director_loan_annual: number | null; director_loan_start_date: string | null;
    }>('SELECT * FROM goals WHERE id=?', [id])
    if (!goal) return res.status(404).json({ message: 'Goal not found' })

    const body = req.body as PropertyAssumptions & { projection_years?: number }
    const assumptions: PropertyAssumptions = {
      purchase_price:      body.purchase_price,
      monthly_rent:        body.monthly_rent,
      monthly_expenses:    body.monthly_expenses ?? 200,
      deposit_percent:     body.deposit_percent ?? 25,
      mortgage_rate:       body.mortgage_rate ?? 5.5,
      mortgage_term_years: body.mortgage_term_years ?? 25,
    }
    const projectionYears = body.projection_years ?? 15

    const { initialState, propertyLabels, activeMortgageCount } = loadPortfolioState()

    const pathways = generatePathways(
      goal as Parameters<typeof generatePathways>[0],
      initialState,
      assumptions,
      projectionYears,
      activeMortgageCount
    )

    const created = transaction(() => {
      const results: unknown[] = []

      // Replace previous generation — delete stale scenarios and pathway rows
      const existing = queryAll<{ scenario_id: number }>(
        'SELECT scenario_id FROM goal_pathways WHERE goal_id = ? AND scenario_id IS NOT NULL',
        [id]
      )
      for (const row of existing) {
        execute('DELETE FROM scenarios WHERE id = ?', [row.scenario_id])
      }
      execute('DELETE FROM goal_pathways WHERE goal_id = ?', [id])

      for (const pw of pathways) {
        // Create scenario
        const scenarioResult = execute(
          `INSERT INTO scenarios (name, description, base_date, projection_years)
           VALUES (?, ?, ?, ?)`,
          [
            `${goal.name} — ${pw.label}`,
            'Auto-generated by Goals pathway engine',
            new Date().toISOString().slice(0, 10),
            projectionYears,
          ]
        )
        const scenarioId = Number(scenarioResult.lastInsertRowid)

        // Insert events
        pw.events.forEach((ev, i) => {
          execute(
            `INSERT INTO scenario_events (scenario_id, event_type, property_id, date, sort_order, parameters_json)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [scenarioId, ev.event_type, ev.property_id ?? null, ev.date, i, ev.parameters_json]
          )
        })

        // Store results
        execute(
          `INSERT INTO scenario_results (scenario_id, results_json) VALUES (?, ?)`,
          [scenarioId, JSON.stringify(pw.results)]
        )

        // Create pathway record
        const pathwayResult = execute(
          `INSERT INTO goal_pathways (goal_id, scenario_id, template_name, label, feasible, reaches_goal, months_to_goal, summary_json, assumptions_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id, scenarioId, pw.template_name, pw.label,
            pw.feasible ? 1 : 0, pw.reaches_goal ? 1 : 0,
            pw.months_to_goal, JSON.stringify(pw.results.summary),
            JSON.stringify({ ...assumptions, projection_years: projectionYears }),
          ]
        )

        results.push({
          id: Number(pathwayResult.lastInsertRowid),
          goal_id: id,
          scenario_id: scenarioId,
          scenario_name: `${goal.name} — ${pw.label}`,
          template_name: pw.template_name,
          label: pw.label,
          feasible: pw.feasible ? 1 : 0,
          reaches_goal: pw.reaches_goal ? 1 : 0,
          months_to_goal: pw.months_to_goal,
          summary: pw.results.summary,
          assumptions: { ...assumptions, projection_years: projectionYears },
          created_at: new Date().toISOString(),
        })
      }
      return results
    })

    logActivity('pathways_generated', 'goal', id, `Generated ${pathways.length} pathways for goal: ${goal.name}`)
    res.status(201).json(created)
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

export default router
