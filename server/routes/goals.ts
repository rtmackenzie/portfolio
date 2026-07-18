import { Router } from 'express'
import { queryAll, queryOne, execute, transaction } from '../db/database.ts'
import { logActivity } from '../services/activityLogger.ts'
import { loadPortfolioState, type ScenarioEvent } from '../services/scenarioEngine.ts'
import { generatePathways, rankPathways, numberOr, TEMPLATES, type Goal, type PropertyAssumptions, type RankablePathway, type RankingMode } from '../services/pathwayGenerator.ts'
import { computeNearestFixes } from '../services/nearestFix.ts'
import { loadTaxSettings, loadAssumptionSettings } from '../services/settings.ts'
import { computeGoalWarnings } from '../services/goalValidation.ts'

const router = Router()

const GOAL_SELECT = `
  SELECT g.*, s.name as scenario_name,
         (SELECT COUNT(*) FROM scenario_events se WHERE se.scenario_id = g.scenario_id) AS committed_event_count
  FROM goals g
  LEFT JOIN scenarios s ON s.id = g.scenario_id
`

router.get('/', (_req, res) => {
  try {
    const goals = queryAll<Goal>(GOAL_SELECT + 'ORDER BY g.created_at DESC')
    const tax = loadTaxSettings()
    res.json(goals.map(g => ({ ...g, warnings: computeGoalWarnings(g, tax) })))
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.get('/:id', (req, res) => {
  try {
    const id = Number(req.params.id)
    const goal = queryOne<Goal>(GOAL_SELECT + 'WHERE g.id = ?', [id])
    if (!goal) return res.status(404).json({ message: 'Not found' })
    res.json({ ...goal, warnings: computeGoalWarnings(goal, loadTaxSettings()) })
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.post('/', (req, res) => {
  try {
    const d = req.body
    const result = execute(
      `INSERT INTO goals (name, goal_type, target_monthly_income, target_property_count, target_equity,
        target_date, max_ltv_pct, min_icr, min_annual_cashflow, scenario_id,
        director_loan_annual, director_loan_start_date,
        starting_cash, mortgage_reprice_years, mortgage_reprice_uplift_bps,
        min_cash_reserve_months, capex_reserve_per_property, erc_pct, ranking_mode, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [d.name, d.goal_type,
       d.target_monthly_income ?? null, d.target_property_count ?? null,
       d.target_equity ?? null, d.target_date ?? null,
       d.max_ltv_pct ?? null, d.min_icr ?? null, d.min_annual_cashflow ?? null,
       d.scenario_id ?? null,
       d.director_loan_annual ?? null, d.director_loan_start_date ?? null,
       d.starting_cash ?? null, d.mortgage_reprice_years ?? null, d.mortgage_reprice_uplift_bps ?? null,
       d.min_cash_reserve_months ?? null, d.capex_reserve_per_property ?? null, d.erc_pct ?? null,
       d.ranking_mode ?? 'fastest', d.notes ?? null]
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
        target_equity=?, target_date=?, max_ltv_pct=?, min_icr=?, min_annual_cashflow=?,
        scenario_id=?, director_loan_annual=?, director_loan_start_date=?,
        starting_cash=?, mortgage_reprice_years=?, mortgage_reprice_uplift_bps=?,
        min_cash_reserve_months=?, capex_reserve_per_property=?, erc_pct=?, ranking_mode=?,
        notes=?, updated_at=datetime('now') WHERE id=?`,
      [d.name, d.goal_type,
       d.target_monthly_income ?? null, d.target_property_count ?? null,
       d.target_equity ?? null, d.target_date ?? null,
       d.max_ltv_pct ?? null, d.min_icr ?? null, d.min_annual_cashflow ?? null,
       d.scenario_id ?? null,
       d.director_loan_annual ?? null, d.director_loan_start_date ?? null,
       d.starting_cash ?? null, d.mortgage_reprice_years ?? null, d.mortgage_reprice_uplift_bps ?? null,
       d.min_cash_reserve_months ?? null, d.capex_reserve_per_property ?? null, d.erc_pct ?? null,
       d.ranking_mode ?? 'fastest',
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
    const goal = queryOne<{ ranking_mode: RankingMode }>('SELECT ranking_mode FROM goals WHERE id=?', [id])
    const rows = queryAll<{ summary_json: string | null; assumptions_json: string | null; risk_breakdown_json: string | null; nearest_fix_json: string | null } & Record<string, unknown>>(
      `SELECT gp.*, s.name as scenario_name
       FROM goal_pathways gp
       LEFT JOIN scenarios s ON s.id = gp.scenario_id
       WHERE gp.goal_id = ? AND gp.scenario_id IS NOT NULL
       ORDER BY gp.created_at DESC, gp.template_name`,
      [id]
    )
    const parsed = rows.map(r => ({
      ...r,
      summary: r.summary_json ? JSON.parse(r.summary_json as string) : null,
      assumptions: r.assumptions_json ? JSON.parse(r.assumptions_json as string) : null,
      risk_breakdown: r.risk_breakdown_json ? JSON.parse(r.risk_breakdown_json as string) : null,
      nearest_fixes: r.nearest_fix_json ? JSON.parse(r.nearest_fix_json as string) : null,
      summary_json: undefined,
      assumptions_json: undefined,
      risk_breakdown_json: undefined,
      nearest_fix_json: undefined,
    }))

    // Rank by time-to-goal + risk under the goal's chosen ranking mode (§P2-8 Appendix B.2);
    // flag the recommended pathway with its provenance (C3).
    res.json(rankPathways(parsed as unknown as RankablePathway[], goal?.ranking_mode ?? 'fastest'))
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
      max_ltv_pct: number | null; min_icr: number | null; min_annual_cashflow: number | null;
      director_loan_annual: number | null; director_loan_start_date: string | null;
      starting_cash: number | null; mortgage_reprice_years: number | null; mortgage_reprice_uplift_bps: number | null;
      min_cash_reserve_months: number | null; capex_reserve_per_property: number | null; erc_pct: number | null;
      scenario_id: number | null;
    }>('SELECT * FROM goals WHERE id=?', [id])
    if (!goal) return res.status(404).json({ message: 'Goal not found' })

    const assumptionSettings = loadAssumptionSettings()
    const body = req.body as PropertyAssumptions & { projection_years?: number }
    const assumptions: PropertyAssumptions = {
      purchase_price:      body.purchase_price,
      monthly_rent:        body.monthly_rent,
      monthly_expenses:    body.monthly_expenses ?? 200,
      deposit_percent:     body.deposit_percent ?? assumptionSettings.default_deposit_percent,
      mortgage_rate:       body.mortgage_rate ?? assumptionSettings.default_mortgage_rate_pct,
      mortgage_term_years: body.mortgage_term_years ?? 25,
      legal_fees:          numberOr(body.legal_fees, numberOr(assumptionSettings.default_legal_fees, 2000)),
      arrangement_fee:     numberOr(body.arrangement_fee, numberOr(assumptionSettings.default_arrangement_fee, 999)),
      valuation_fee:       numberOr(body.valuation_fee, numberOr(assumptionSettings.default_valuation_fee, 300)),
    }
    const projectionYears = body.projection_years ?? 15

    const { initialState, propertyLabels, activeMortgageCount } = loadPortfolioState()

    // A linked scenario's events are treated as decisions already committed to: every strategy
    // plans on top of them, sharing one cash pot and timeline, rather than starting from today's
    // portfolio alone. Same ordering the scenarios route uses when it projects a scenario.
    const committedEvents = goal.scenario_id
      ? queryAll<ScenarioEvent>(
          'SELECT * FROM scenario_events WHERE scenario_id=? ORDER BY date, sort_order',
          [goal.scenario_id]
        )
      : []

    // sim_property_id targets a property bought inside the simulation. Those ids are assigned
    // sequentially at projection time, so interleaved generated buys would shift what a committed
    // event points at. Hand-built scenarios target real properties via property_id and never set
    // this, but drop any that do rather than silently re-target the wrong property.
    const retargetable = committedEvents.filter(ev => {
      try { return JSON.parse(ev.parameters_json || '{}').sim_property_id != null }
      catch { return false }
    })
    const safeCommittedEvents = retargetable.length > 0
      ? committedEvents.filter(ev => !retargetable.includes(ev))
      : committedEvents

    const tax = loadTaxSettings()
    const pathways = generatePathways(
      goal as Parameters<typeof generatePathways>[0],
      initialState,
      assumptions,
      projectionYears,
      activeMortgageCount,
      tax,
      assumptionSettings,
      safeCommittedEvents
    )

    // Nearest-feasible hints (§P2-8c): computed once here, where the full generation context
    // (initial state, assumptions, tax/settings) is in scope — not recomputed on read.
    const fixesByTemplate = new Map<string, ReturnType<typeof computeNearestFixes>>()
    for (const pw of pathways) {
      if (pw.reaches_goal) continue
      const t = TEMPLATES.find(tpl => tpl.template_name === pw.template_name)
      if (!t) continue
      fixesByTemplate.set(pw.template_name, computeNearestFixes(pw, t, goal as Parameters<typeof generatePathways>[0], initialState, assumptions, projectionYears, tax, assumptionSettings, safeCommittedEvents))
    }

    const created = transaction(() => {
      const results: unknown[] = []

      // Replace previous generation — delete stale scenarios and pathway rows
      const existing = queryAll<{ scenario_id: number }>(
        'SELECT scenario_id FROM goal_pathways WHERE goal_id = ? AND scenario_id IS NOT NULL',
        [id]
      )
      for (const row of existing) {
        // Never delete the goal's own linked scenario — that is a hand-built scenario the user
        // owns, not a generated one. It should only ever appear here via a stale/mislinked row,
        // but deleting it would be silent data loss.
        if (goal.scenario_id != null && row.scenario_id === goal.scenario_id) continue
        execute('DELETE FROM scenarios WHERE id = ?', [row.scenario_id])
      }
      execute('DELETE FROM goal_pathways WHERE goal_id = ?', [id])

      for (const pw of pathways) {
        // Create scenario
        const scenarioResult = execute(
          `INSERT INTO scenarios (name, description, base_date, projection_years, assumptions_json)
           VALUES (?, ?, ?, ?, ?)`,
          [
            `${goal.name} — ${pw.label}`,
            'Auto-generated by Goals pathway engine',
            new Date().toISOString().slice(0, 10),
            projectionYears,
            pw.assumptions_json,
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
        const nearestFixes = fixesByTemplate.get(pw.template_name) ?? []
        const pathwayResult = execute(
          `INSERT INTO goal_pathways (goal_id, scenario_id, template_name, label, feasible, reaches_goal, months_to_goal, summary_json, assumptions_json, risk_score, risk_breakdown_json, shortfall, binding_constraint, binding_detail, nearest_fix_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id, scenarioId, pw.template_name, pw.label,
            pw.feasible ? 1 : 0, pw.reaches_goal ? 1 : 0,
            pw.months_to_goal, JSON.stringify(pw.results.summary),
            JSON.stringify({ ...assumptions, projection_years: projectionYears }),
            pw.risk_score, JSON.stringify(pw.risk_breakdown), pw.shortfall,
            pw.binding_constraint, pw.binding_detail, JSON.stringify(nearestFixes),
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
          assumptions_json: pw.assumptions_json,
          risk_score: pw.risk_score,
          risk_band: pw.risk_band,
          risk_breakdown: pw.risk_breakdown,
          shortfall: pw.shortfall,
          binding_constraint: pw.binding_constraint,
          binding_detail: pw.binding_detail,
          nearest_fixes: nearestFixes,
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
