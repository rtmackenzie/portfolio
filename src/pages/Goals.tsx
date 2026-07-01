import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import type { Goal, GoalType, GoalPathway, PropertyAssumptions, Scenario } from '@/types'
import { formatCurrency } from '@/utils/currency'
import { useGoalPathways, useGeneratePathways } from '@/hooks/useGoals'

// ─── Schema ──────────────────────────────────────────────────────────────────

const goalSchema = z.object({
  name: z.string().min(1),
  goal_type: z.enum(['income', 'count', 'net_worth', 'mortgage_free', 'retirement_date']),
  target_monthly_income:  z.coerce.number().optional(),
  target_property_count:  z.coerce.number().int().optional(),
  target_equity:          z.coerce.number().optional(),
  target_date:            z.string().optional(),
  max_ltv_pct:            z.coerce.number().min(0).max(100).optional(),
  min_dscr:               z.coerce.number().min(0).optional(),
  min_annual_cashflow:    z.coerce.number().optional(),
  director_loan_annual:       z.coerce.number().min(0).optional(),
  director_loan_start_date:   z.string().optional(),
  starting_cash:              z.coerce.number().min(0).optional(),
  mortgage_reprice_years:     z.coerce.number().min(1).optional(),
  mortgage_reprice_uplift_bps: z.coerce.number().min(0).optional(),
  scenario_id:            z.coerce.number().optional(),
  notes: z.string().optional(),
})

type GoalFormValues = z.infer<typeof goalSchema>

// ─── Helpers ──────────────────────────────────────────────────────────────────

const GOAL_TYPE_LABELS: Record<GoalType, string> = {
  income:          'Monthly income target',
  count:           'Property count target',
  net_worth:       'Net worth / equity target',
  mortgage_free:   'Mortgage-free by date',
  retirement_date: 'Retirement date',
}

const GOAL_TYPE_BADGE: Record<GoalType, string> = {
  income:          'bg-emerald-500/15 text-emerald-400',
  count:           'bg-blue-500/15 text-blue-400',
  net_worth:       'bg-purple-500/15 text-purple-400',
  mortgage_free:   'bg-orange-500/15 text-orange-400',
  retirement_date: 'bg-rose-500/15 text-rose-400',
}

function goalSummary(g: Goal): string {
  switch (g.goal_type) {
    case 'income':          return g.target_monthly_income ? `${formatCurrency(g.target_monthly_income)}/mo` : '—'
    case 'count':           return g.target_property_count ? `${g.target_property_count} properties` : '—'
    case 'net_worth':       return g.target_equity ? formatCurrency(g.target_equity) : '—'
    case 'mortgage_free':
    case 'retirement_date': return g.target_date ?? '—'
  }
}

const inputCls = 'w-full px-3 py-2 rounded-md bg-input border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary'
const labelCls = 'block text-xs font-medium text-muted-foreground mb-1'

// Hover tooltip wrapper. Uses React state, not CSS group-hover (which doesn't
// work in this project's Tailwind v4 setup). Renders an inline dotted-underline
// span with an absolutely-positioned popover above it.
function Tip({ text, children, className = '' }: { text: string; children: string; className?: string }) {
  const [show, setShow] = useState(false)
  return (
    <span className={`relative ${className}`}>
      <span
        className="underline decoration-dotted decoration-muted-foreground/40 cursor-default"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
      >
        {children}
      </span>
      {show && (
        <div className="absolute bottom-full left-0 mb-1 w-56 rounded-md bg-popover border border-border text-xs font-normal normal-case text-popover-foreground p-2 shadow-lg z-50 whitespace-normal leading-relaxed">
          {text}
        </div>
      )}
    </span>
  )
}

// ─── Goal Form ────────────────────────────────────────────────────────────────

function GoalForm({ goal, scenarios, onSaved, onDeleted }: {
  goal: Goal | null
  scenarios: Scenario[]
  onSaved: (g: Goal) => void
  onDeleted: () => void
}) {
  const qc = useQueryClient()
  const isNew = !goal

  const create = useMutation({
    mutationFn: (d: Partial<Goal>) => api.post<Goal>('/goals', d),
    onSuccess: (g) => { qc.invalidateQueries({ queryKey: ['goals'] }); onSaved(g) },
  })
  const update = useMutation({
    mutationFn: (d: Partial<Goal>) => api.put<Goal>(`/goals/${goal!.id}`, d),
    onSuccess: (g) => { qc.invalidateQueries({ queryKey: ['goals'] }); onSaved(g) },
  })
  const del = useMutation({
    mutationFn: () => api.delete(`/goals/${goal!.id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['goals'] }); onDeleted() },
  })

  const { register, handleSubmit, watch, reset } = useForm<GoalFormValues>({
    resolver: zodResolver(goalSchema) as any,
    defaultValues: goal ? {
      name:                  goal.name,
      goal_type:             goal.goal_type,
      target_monthly_income: goal.target_monthly_income ?? undefined,
      target_property_count: goal.target_property_count ?? undefined,
      target_equity:         goal.target_equity ?? undefined,
      target_date:           goal.target_date ?? undefined,
      max_ltv_pct:           goal.max_ltv_pct ?? undefined,
      min_dscr:              goal.min_dscr ?? undefined,
      min_annual_cashflow:   goal.min_annual_cashflow ?? undefined,
      director_loan_annual:      goal.director_loan_annual ?? undefined,
      director_loan_start_date:  goal.director_loan_start_date ?? undefined,
      starting_cash:              goal.starting_cash ?? undefined,
      mortgage_reprice_years:     goal.mortgage_reprice_years ?? undefined,
      mortgage_reprice_uplift_bps: goal.mortgage_reprice_uplift_bps ?? undefined,
      scenario_id:           goal.scenario_id ?? undefined,
      notes:                 goal.notes ?? '',
    } : { goal_type: 'net_worth' },
  })

  useEffect(() => {
    reset(goal ? {
      name:                  goal.name,
      goal_type:             goal.goal_type,
      target_monthly_income: goal.target_monthly_income ?? undefined,
      target_property_count: goal.target_property_count ?? undefined,
      target_equity:         goal.target_equity ?? undefined,
      target_date:           goal.target_date ?? undefined,
      max_ltv_pct:           goal.max_ltv_pct ?? undefined,
      min_dscr:              goal.min_dscr ?? undefined,
      min_annual_cashflow:   goal.min_annual_cashflow ?? undefined,
      director_loan_annual:      goal.director_loan_annual ?? undefined,
      director_loan_start_date:  goal.director_loan_start_date ?? undefined,
      starting_cash:              goal.starting_cash ?? undefined,
      mortgage_reprice_years:     goal.mortgage_reprice_years ?? undefined,
      mortgage_reprice_uplift_bps: goal.mortgage_reprice_uplift_bps ?? undefined,
      scenario_id:           goal.scenario_id ?? undefined,
      notes:                 goal.notes ?? '',
    } : { goal_type: 'net_worth' })
  }, [goal?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const goalType = watch('goal_type')
  const isPending = create.isPending || update.isPending

  function onSubmit(d: GoalFormValues) {
    const payload: Partial<Goal> = {
      name:      d.name,
      goal_type: d.goal_type,
      target_monthly_income:  d.goal_type === 'income'          ? (d.target_monthly_income ?? null) : null,
      target_property_count:  d.goal_type === 'count'           ? (d.target_property_count ?? null) : null,
      target_equity:          d.goal_type === 'net_worth'       ? (d.target_equity ?? null)          : null,
      target_date:            (d.goal_type === 'mortgage_free' || d.goal_type === 'retirement_date')
                                ? (d.target_date ?? null) : null,
      max_ltv_pct:          d.max_ltv_pct ?? null,
      min_dscr:             d.min_dscr ?? null,
      min_annual_cashflow:  d.min_annual_cashflow ?? null,
      director_loan_annual:      d.director_loan_annual ?? null,
      director_loan_start_date:  d.director_loan_start_date || null,
      starting_cash:              d.starting_cash ?? null,
      mortgage_reprice_years:     d.mortgage_reprice_years ?? null,
      mortgage_reprice_uplift_bps: d.mortgage_reprice_uplift_bps ?? null,
      scenario_id:          d.scenario_id || null,
      notes:                d.notes || null,
    }
    isNew ? create.mutate(payload) : update.mutate(payload)
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      {/* Basic */}
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className={labelCls}><Tip text="A short name to identify this goal in your list.">Goal name *</Tip></label>
          <input {...register('name')} className={inputCls} placeholder="e.g. Financial independence by 2035" />
        </div>
        <div className="col-span-2">
          <label className={labelCls}><Tip text="What this goal tracks — monthly income, property count, net worth/equity, becoming mortgage-free, or a retirement date.">Goal type *</Tip></label>
          <select {...register('goal_type')} className={inputCls}>
            {(Object.entries(GOAL_TYPE_LABELS) as [GoalType, string][]).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Target value — conditional on goal_type */}
      <div className="border border-border rounded-lg p-4 space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Target</p>
        {goalType === 'income' && (
          <div>
            <label className={labelCls}><Tip text="The net monthly cashflow (rent minus mortgage, expenses and voids) you want the portfolio to produce.">Monthly net income target (£/mo)</Tip></label>
            <input type="number" {...register('target_monthly_income')} className={inputCls} placeholder="e.g. 5000" />
          </div>
        )}
        {goalType === 'count' && (
          <div>
            <label className={labelCls}><Tip text="The total number of properties you want to own.">Target property count</Tip></label>
            <input type="number" {...register('target_property_count')} className={inputCls} placeholder="e.g. 10" />
          </div>
        )}
        {goalType === 'net_worth' && (
          <div>
            <label className={labelCls}><Tip text="The total equity (property value minus outstanding debt) you want to reach.">Target equity / net worth (£)</Tip></label>
            <input type="number" {...register('target_equity')} className={inputCls} placeholder="e.g. 500000" />
          </div>
        )}
        {(goalType === 'mortgage_free' || goalType === 'retirement_date') && (
          <div>
            <label className={labelCls}><Tip text={goalType === 'mortgage_free' ? 'The date by which you want all mortgages cleared.' : 'The date by which you want to be able to retire on the portfolio income.'}>{goalType === 'mortgage_free' ? 'Mortgage-free by' : 'Retirement date'}</Tip></label>
            <input type="date" {...register('target_date')} className={inputCls} />
          </div>
        )}
      </div>

      {/* Constraints */}
      <div className="border border-border rounded-lg p-4 space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Constraints <span className="font-normal normal-case text-muted-foreground/70">(optional)</span></p>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className={labelCls}><Tip text="Ceiling on portfolio loan-to-value. Pathways that exceed this in any month are marked infeasible.">Max LTV (%)</Tip></label>
            <input type="number" {...register('max_ltv_pct')} className={inputCls} placeholder="e.g. 75" />
          </div>
          <div>
            <label className={labelCls}><Tip text="Floor on Debt Service Coverage Ratio (rent ÷ mortgage). Below ~1.25× signals lender and cashflow stress.">Min DSCR (×)</Tip></label>
            <input type="number" step="0.01" {...register('min_dscr')} className={inputCls} placeholder="e.g. 1.25" />
          </div>
          <div>
            <label className={labelCls}><Tip text="Minimum net cashflow per year the portfolio must sustain. Pathways dipping below this are infeasible.">Min cash/yr (£)</Tip></label>
            <input type="number" {...register('min_annual_cashflow')} className={inputCls} placeholder="e.g. 12000" />
          </div>
        </div>
      </div>

      {/* Director loans */}
      <div className="border border-border rounded-lg p-4 space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Director loans <span className="font-normal normal-case text-muted-foreground/70">(optional)</span></p>
        <p className="text-xs text-muted-foreground">Cash injected annually from the company. Accumulates toward deposits and mortgage payoffs when generating pathways.</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}><Tip text="Cash injected from the company each year. It accumulates toward deposits and mortgage payoffs, accelerating the pathways.">Annual loan amount (£/yr)</Tip></label>
            <input type="number" {...register('director_loan_annual')} className={inputCls} placeholder="e.g. 15000" />
          </div>
          <div>
            <label className={labelCls}><Tip text="When the first director-loan injection occurs. Defaults to the projection start date if left blank.">First loan date</Tip></label>
            <input type="date" {...register('director_loan_start_date')} className={inputCls} />
          </div>
        </div>
      </div>

      {/* Advanced assumptions */}
      <div className="border border-border rounded-lg p-4 space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Advanced assumptions <span className="font-normal normal-case text-muted-foreground/70">(optional)</span></p>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className={labelCls}><Tip text="Cash already on hand today. Defaults to an assumed adequate reserve for your existing portfolio if left blank.">Starting cash (£)</Tip></label>
            <input type="number" {...register('starting_cash')} className={inputCls} placeholder="e.g. 10000" />
          </div>
          <div>
            <label className={labelCls}><Tip text="How often a fixed-rate mortgage deal expires and reverts to a new rate. Defaults to 5 years.">Mortgage reprice term (years)</Tip></label>
            <input type="number" {...register('mortgage_reprice_years')} className={inputCls} placeholder="e.g. 5" />
          </div>
          <div>
            <label className={labelCls}><Tip text="Rate increase applied each time a mortgage reprices (200 = +2%). Defaults to 200.">Reprice uplift (bps)</Tip></label>
            <input type="number" {...register('mortgage_reprice_uplift_bps')} className={inputCls} placeholder="e.g. 200" />
          </div>
        </div>
      </div>

      {/* Linked scenario */}
      <div>
        <label className={labelCls}><Tip text="Optionally tie a manually-built What-If scenario to this goal so you can track progress against it.">Linked scenario (optional)</Tip></label>
        <select {...register('scenario_id')} className={inputCls}>
          <option value="">None — or pick a scenario to represent this goal</option>
          {scenarios.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground mt-1">Link a manually-built What-If scenario to track progress toward this goal. Pathways generated in future will also link here.</p>
      </div>

      {/* Notes */}
      <div>
        <label className={labelCls}><Tip text="Free-text notes or assumptions for your own reference. Not used in any calculation.">Notes</Tip></label>
        <textarea {...register('notes')} className={inputCls} rows={2} placeholder="Any context or assumptions…" />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 pt-1">
        <button type="submit" disabled={isPending} className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium disabled:opacity-50">
          {isPending ? 'Saving…' : isNew ? 'Create goal' : 'Save changes'}
        </button>
        {!isNew && (
          <button
            type="button"
            onClick={() => del.mutate()}
            disabled={del.isPending}
            className="px-4 py-2 border border-red-500/40 text-red-400 rounded-md text-sm hover:bg-red-500/10 disabled:opacity-50"
          >
            Delete
          </button>
        )}
      </div>
    </form>
  )
}

// ─── Assumptions schema ───────────────────────────────────────────────────────

const assumptionsSchema = z.object({
  purchase_price:      z.coerce.number().min(1),
  monthly_rent:        z.coerce.number().min(1),
  monthly_expenses:    z.coerce.number().min(0),
  deposit_percent:     z.coerce.number().min(1).max(100),
  mortgage_rate:       z.coerce.number().min(0),
  mortgage_term_years: z.coerce.number().int().min(1),
  projection_years:    z.coerce.number().int().min(1).max(30),
})

type AssumptionsFormValues = z.infer<typeof assumptionsSchema>

function formatMonthsToGoal(m: number | null | undefined): string {
  if (m == null) return 'Not reached'
  const yr = Math.floor(m / 12)
  const mo = m % 12
  if (yr === 0) return `${mo}mo`
  if (mo === 0) return `${yr}yr`
  return `${yr}yr ${mo}mo`
}

// ─── Pathways panel ───────────────────────────────────────────────────────────

const ASSUMPTION_DEFAULTS: AssumptionsFormValues = {
  purchase_price: 180000,
  monthly_rent: 950,
  monthly_expenses: 200,
  deposit_percent: 25,
  mortgage_rate: 5.5,
  mortgage_term_years: 25,
  projection_years: 15,
}

function PathwaysPanel({ goal }: { goal: Goal }) {
  const { data: pathways = [], isLoading } = useGoalPathways(goal.id)
  const generate = useGeneratePathways(goal.id)

  const { register, handleSubmit, reset } = useForm<AssumptionsFormValues>({
    resolver: zodResolver(assumptionsSchema) as any,
    defaultValues: ASSUMPTION_DEFAULTS,
  })

  // Pre-populate form from the most recent generation's assumptions once loaded
  const latestAssumptions = pathways[0]?.assumptions
  useEffect(() => {
    if (latestAssumptions) {
      reset({ ...ASSUMPTION_DEFAULTS, ...latestAssumptions })
    }
  }, [latestAssumptions?.purchase_price, latestAssumptions?.monthly_rent]) // eslint-disable-line react-hooks/exhaustive-deps

  function onGenerate(d: AssumptionsFormValues) {
    generate.mutate(d as PropertyAssumptions)
  }

  // Pathways arrive pre-ranked from the API (rank + recommended already attached)
  const noneFeasible = pathways.length > 0 && !pathways.some(p => p.feasible)

  return (
    <div className="mt-6 border-t border-border pt-6 space-y-5">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Generate pathways</p>

      {/* Assumptions form */}
      <form onSubmit={handleSubmit(onGenerate)} className="space-y-3">
        <div className="grid grid-cols-4 gap-3">
          <div>
            <label className={labelCls}><Tip text="Assumed purchase price for each new property the pathways buy.">Purchase price (£)</Tip></label>
            <input type="number" {...register('purchase_price')} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}><Tip text="Assumed gross monthly rent per new property, before costs.">Monthly rent (£)</Tip></label>
            <input type="number" {...register('monthly_rent')} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}><Tip text="Assumed monthly running costs per property — management, maintenance, insurance.">Monthly expenses (£)</Tip></label>
            <input type="number" {...register('monthly_expenses')} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}><Tip text="Deposit as a percentage of price. The remainder is financed with a mortgage and drawn from accumulated cash.">Deposit (%)</Tip></label>
            <input type="number" {...register('deposit_percent')} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}><Tip text="Assumed annual interest rate on new mortgages.">Mortgage rate (%)</Tip></label>
            <input type="number" step="0.1" {...register('mortgage_rate')} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}><Tip text="Mortgage repayment term in years.">Term (years)</Tip></label>
            <input type="number" {...register('mortgage_term_years')} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}><Tip text="How many years forward to project each pathway.">Projection (years)</Tip></label>
            <input type="number" {...register('projection_years')} className={inputCls} />
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={generate.isPending}
              className="w-full px-3 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium disabled:opacity-50"
            >
              {generate.isPending ? 'Generating…' : 'Generate'}
            </button>
          </div>
        </div>
        {generate.isError && (
          <p className="text-xs text-red-400">{String((generate.error as Error)?.message ?? 'Generation failed')}</p>
        )}
      </form>

      {/* Pathway list */}
      {isLoading && <p className="text-xs text-muted-foreground">Loading pathways…</p>}

      {!isLoading && pathways.length === 0 && (
        <p className="text-xs text-muted-foreground">No pathways generated yet. Fill in the assumptions above and click Generate.</p>
      )}

      {noneFeasible && (
        <div className="text-xs px-3 py-2 rounded-md bg-red-500/10 border border-red-500/30 text-red-400">
          No feasible pathway — relax a constraint (max LTV, min DSCR, min cash/yr) or add director-loan capital, then regenerate.
        </div>
      )}

      {pathways.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {pathways.map(pw => (
            <div
              key={pw.id}
              className={`bg-background border rounded-lg p-3 space-y-2 ${pw.recommended ? 'border-primary ring-1 ring-primary/40' : 'border-border'}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-semibold text-muted-foreground">#{pw.rank}</span>
                  <span className="text-sm font-medium">{pw.label}</span>
                </div>
                <div className="flex gap-1 flex-wrap justify-end">
                  {pw.recommended && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary/15 text-primary">★ Recommended</span>
                  )}
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${pw.feasible ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                    {pw.feasible ? 'feasible' : 'infeasible'}
                  </span>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${pw.reaches_goal ? 'bg-blue-500/15 text-blue-400' : 'bg-muted text-muted-foreground'}`}>
                    {pw.reaches_goal ? 'reaches goal' : 'goal not reached'}
                  </span>
                </div>
              </div>

              {pw.summary && (
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                  <div>
                    <Tip className="text-muted-foreground" text="Projected total equity (property value minus debt) at the end of the projection.">End equity</Tip>
                    <div className="font-medium">{formatCurrency(pw.summary.end_equity)}</div>
                  </div>
                  <div>
                    <Tip className="text-muted-foreground" text="Post-tax net monthly cashflow in the final month — the steady-state spendable income the goal solver judges income goals against. Uses your global Tax settings.">Ending CF/mo (post-tax)</Tip>
                    <div className={`font-medium ${(pw.summary.ending_monthly_cashflow_posttax ?? pw.summary.ending_monthly_cashflow ?? 0) >= 0 ? '' : 'text-red-400'}`}>
                      {formatCurrency(pw.summary.ending_monthly_cashflow_posttax ?? pw.summary.ending_monthly_cashflow ?? 0)}
                    </div>
                  </div>
                  <div>
                    <Tip className="text-muted-foreground" text="Average monthly net cashflow across the whole projection. Lower than the ending figure because the early years hold fewer properties.">Avg CF/mo</Tip>
                    <div className={`font-medium ${pw.summary.avg_monthly_cashflow >= 0 ? '' : 'text-red-400'}`}>
                      {formatCurrency(pw.summary.avg_monthly_cashflow)}
                    </div>
                  </div>
                  <div>
                    <Tip className="text-muted-foreground" text="Lowest Debt Service Coverage Ratio (rent ÷ mortgage) reached in any month.">Min DSCR</Tip>
                    <div className="font-medium">{pw.summary.min_dscr > 0 ? `${pw.summary.min_dscr.toFixed(2)}×` : '—'}</div>
                  </div>
                  <div>
                    <Tip className="text-muted-foreground" text="How long until this pathway first meets the goal, or 'Not reached' within the projection horizon.">Time to goal</Tip>
                    <div className="font-medium">{formatMonthsToGoal(pw.months_to_goal)}</div>
                  </div>
                </div>
              )}

              {pw.binding_detail && (
                <div className="text-[11px] text-muted-foreground border-t border-border pt-1.5">
                  <span className="font-medium text-foreground">Limited by:</span> {pw.binding_detail}
                </div>
              )}

              {pw.scenario_id && (
                <a
                  href="/scenarios"
                  className="block text-[11px] text-primary hover:underline mt-1"
                >
                  View in What-If →
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function Goals() {
  const [selectedId, setSelectedId] = useState<number | 'new' | null>(null)

  const { data: goals = [], isLoading } = useQuery({
    queryKey: ['goals', 'list'],
    queryFn: () => api.get<Goal[]>('/goals'),
  })

  const { data: scenarios = [] } = useQuery({
    queryKey: ['scenarios'],
    queryFn: () => api.get<Scenario[]>('/scenarios'),
  })

  const selected = selectedId === 'new' ? null : goals.find(g => g.id === selectedId) ?? null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Goals</h1>
        <p className="text-sm text-muted-foreground mt-1">Define your investment target and the constraints any plan must respect.</p>
      </div>

      <div className="grid grid-cols-4 gap-6 items-start">
        {/* Left: list */}
        <div className="col-span-1 space-y-2">
          <button
            onClick={() => setSelectedId('new')}
            className={`w-full text-left px-3 py-2.5 rounded-md text-sm font-medium border transition-colors ${
              selectedId === 'new'
                ? 'bg-primary/15 border-primary/60 text-primary'
                : 'border-dashed border-border text-muted-foreground hover:bg-accent hover:text-foreground'
            }`}
          >
            + New goal
          </button>

          {isLoading && <p className="text-xs text-muted-foreground px-1">Loading…</p>}

          {goals.map(g => (
            <button
              key={g.id}
              onClick={() => setSelectedId(g.id)}
              className={`w-full text-left px-3 py-2.5 rounded-md transition-colors ${
                selectedId === g.id
                  ? 'bg-primary/15 text-primary'
                  : 'bg-card text-foreground hover:bg-accent'
              }`}
            >
              <div className="text-sm font-medium truncate">{g.name}</div>
              <div className="flex items-center gap-1.5 mt-1">
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${GOAL_TYPE_BADGE[g.goal_type]}`}>
                  {g.goal_type.replace(/_/g, ' ')}
                </span>
                <span className="text-[11px] text-muted-foreground">{goalSummary(g)}</span>
              </div>
              {g.scenario_name && (
                <div className="text-[11px] text-muted-foreground mt-0.5 truncate">↳ {g.scenario_name}</div>
              )}
            </button>
          ))}
        </div>

        {/* Right: detail / form */}
        <div className="col-span-3">
          {selectedId === null ? (
            <div className="bg-card rounded-lg p-8 text-center text-muted-foreground">
              Select a goal or create a new one
            </div>
          ) : (
            <div className="bg-card rounded-lg p-5">
              <h2 className="text-base font-semibold mb-5">
                {selectedId === 'new' ? 'New goal' : selected?.name ?? 'Edit goal'}
              </h2>
              <GoalForm
                key={selectedId}
                goal={selected}
                scenarios={scenarios}
                onSaved={(g) => setSelectedId(g.id)}
                onDeleted={() => setSelectedId(null)}
              />
              {selected && <PathwaysPanel goal={selected} />}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
