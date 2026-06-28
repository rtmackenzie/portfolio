import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import type { Goal, GoalType, Scenario } from '@/types'
import { formatCurrency } from '@/utils/currency'

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
          <label className={labelCls}>Goal name *</label>
          <input {...register('name')} className={inputCls} placeholder="e.g. Financial independence by 2035" />
        </div>
        <div className="col-span-2">
          <label className={labelCls}>Goal type *</label>
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
            <label className={labelCls}>Monthly net income target (£/mo)</label>
            <input type="number" {...register('target_monthly_income')} className={inputCls} placeholder="e.g. 5000" />
          </div>
        )}
        {goalType === 'count' && (
          <div>
            <label className={labelCls}>Target property count</label>
            <input type="number" {...register('target_property_count')} className={inputCls} placeholder="e.g. 10" />
          </div>
        )}
        {goalType === 'net_worth' && (
          <div>
            <label className={labelCls}>Target equity / net worth (£)</label>
            <input type="number" {...register('target_equity')} className={inputCls} placeholder="e.g. 500000" />
          </div>
        )}
        {(goalType === 'mortgage_free' || goalType === 'retirement_date') && (
          <div>
            <label className={labelCls}>{goalType === 'mortgage_free' ? 'Mortgage-free by' : 'Retirement date'}</label>
            <input type="date" {...register('target_date')} className={inputCls} />
          </div>
        )}
      </div>

      {/* Constraints */}
      <div className="border border-border rounded-lg p-4 space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Constraints <span className="font-normal normal-case text-muted-foreground/70">(optional)</span></p>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className={labelCls}>Max LTV (%)</label>
            <input type="number" {...register('max_ltv_pct')} className={inputCls} placeholder="e.g. 75" />
          </div>
          <div>
            <label className={labelCls}>Min DSCR (×)</label>
            <input type="number" step="0.01" {...register('min_dscr')} className={inputCls} placeholder="e.g. 1.25" />
          </div>
          <div>
            <label className={labelCls}>Min cash/yr (£)</label>
            <input type="number" {...register('min_annual_cashflow')} className={inputCls} placeholder="e.g. 12000" />
          </div>
        </div>
      </div>

      {/* Linked scenario */}
      <div>
        <label className={labelCls}>Linked scenario (optional)</label>
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
        <label className={labelCls}>Notes</label>
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
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
