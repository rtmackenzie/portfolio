import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Play, X, Trash2, Pencil } from 'lucide-react'
import { api } from '@/services/api'
import { PageLoader } from '@/components/shared/LoadingSpinner'
import { ScenarioAreaChart, CHART_COLORS } from '@/components/charts'
import { formatCurrency, formatPercent } from '@/utils/currency'
import { formatDate } from '@/utils/dates'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import type { Scenario, ScenarioResults } from '@/types'

const scenarioSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  base_date: z.string().min(1),
  projection_years: z.coerce.number().min(1).max(30),
})

const inputCls = 'w-full px-3 py-2 rounded-md bg-input border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary'
const labelCls = 'block text-xs font-medium text-muted-foreground mb-1'

const EVENT_TYPES = [
  { value: 'buy_property', label: 'Buy Property' },
  { value: 'sell_property', label: 'Sell Property' },
  { value: 'remortgage', label: 'Remortgage' },
  { value: 'rent_change', label: 'Rent Change' },
  { value: 'vacancy_period', label: 'Vacancy Period' },
  { value: 'major_expense', label: 'Major Expense' },
  { value: 'interest_rate_change', label: 'Interest Rate Change' },
  { value: 'payoff_mortgage', label: 'Pay Off Mortgage' },
]

export default function Scenarios() {
  const qc = useQueryClient()
  const { data: scenarios, isLoading } = useQuery({
    queryKey: ['scenarios'],
    queryFn: () => api.get<Scenario[]>('/scenarios'),
  })
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [showAddEvent, setShowAddEvent] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [editingEvent, setEditingEvent] = useState<import('@/types').ScenarioEvent | null>(null)

  const { data: selected } = useQuery({
    queryKey: ['scenarios', selectedId],
    queryFn: () => api.get<Scenario>(`/scenarios/${selectedId}`),
    enabled: !!selectedId,
  })

  const deleteScenario = useMutation({
    mutationFn: (id: number) => api.delete(`/scenarios/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['scenarios'] }); setSelectedId(null) },
  })

  const calculate = useMutation({
    mutationFn: (id: number) => api.post<ScenarioResults>(`/scenarios/${id}/calculate`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scenarios', selectedId] }),
  })

  const deleteEvent = useMutation({
    mutationFn: ({ scenarioId, eventId }: { scenarioId: number; eventId: number }) =>
      api.delete(`/scenarios/${scenarioId}/events/${eventId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scenarios', selectedId] }),
  })

  if (isLoading) return <PageLoader />

  const results = selected?.results as ScenarioResults | null | undefined

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">What-If Scenarios</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Model financial projections and compare outcomes</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium">
          <Plus size={16} /> New Scenario
        </button>
      </div>

      <div className="grid grid-cols-4 gap-6">
        {/* Scenario list */}
        <div className="col-span-1 space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Scenarios</h3>
          {!scenarios || scenarios.length === 0 ? (
            <p className="text-sm text-muted-foreground">No scenarios yet</p>
          ) : (
            scenarios.map(s => (
              <button
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                className={`w-full text-left px-3 py-2.5 rounded-md text-sm transition-colors ${selectedId === s.id ? 'bg-primary/15 text-primary' : 'bg-card text-foreground hover:bg-accent'}`}
              >
                <div className="font-medium">{s.name}</div>
                <div className="text-xs text-muted-foreground">{s.projection_years}yr projection</div>
              </button>
            ))
          )}
        </div>

        {/* Detail panel */}
        <div className="col-span-3 space-y-5">
          {!selectedId ? (
            <div className="bg-card rounded-lg p-8 text-center text-muted-foreground">
              Select a scenario or create a new one
            </div>
          ) : selected ? (
            <>
              <div className="bg-card rounded-lg p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-base font-semibold">{selected.name}</h2>
                    {selected.description && <p className="text-sm text-muted-foreground">{selected.description}</p>}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => calculate.mutate(selected.id)}
                      disabled={calculate.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-xs font-medium disabled:opacity-50"
                    >
                      <Play size={12} /> {calculate.isPending ? 'Running...' : 'Run Projection'}
                    </button>
                    <button onClick={() => setShowEdit(true)} title="Edit scenario" className="px-3 py-1.5 border border-border rounded-md text-xs text-muted-foreground hover:bg-accent">
                      <Pencil size={12} />
                    </button>
                    <button onClick={() => deleteScenario.mutate(selected.id)} className="px-3 py-1.5 border border-red-500/40 text-red-400 rounded-md text-xs hover:bg-red-500/10">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div><span className="text-muted-foreground">Base Date: </span><span className="font-medium">{formatDate(selected.base_date)}</span></div>
                  <div><span className="text-muted-foreground">Projection: </span><span className="font-medium">{selected.projection_years} years</span></div>
                  <div><span className="text-muted-foreground">Events: </span><span className="font-medium">{selected.events?.length ?? 0}</span></div>
                </div>
              </div>

              {/* Events */}
              <div className="bg-card rounded-lg p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold">Events Timeline</h3>
                  <button onClick={() => setShowAddEvent(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-muted text-foreground rounded-md text-xs">
                    <Plus size={12} /> Add Event
                  </button>
                </div>
                {!selected.events || selected.events.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No events added. Run projection to use current portfolio as baseline.</p>
                ) : (
                  <div className="space-y-2">
                    {selected.events.map(ev => {
                      const params = JSON.parse(ev.parameters_json || '{}')
                      return (
                        <div key={ev.id} className="flex items-center justify-between bg-background rounded-md px-3 py-2">
                          <div className="flex items-center gap-3">
                            <span className="text-xs font-medium text-primary">{formatDate(ev.date)}</span>
                            <span className="text-sm capitalize">{ev.event_type.replace(/_/g, ' ')}</span>
                            {Object.keys(params).length > 0 && (
                              <span className="text-xs text-muted-foreground">{JSON.stringify(params).slice(0, 60)}</span>
                            )}
                          </div>
                          <div className="flex gap-1">
                            <button onClick={() => setEditingEvent(ev)} className="text-muted-foreground hover:text-foreground">
                              <Pencil size={13} />
                            </button>
                            <button
                              onClick={() => deleteEvent.mutate({ scenarioId: selected.id, eventId: ev.id })}
                              className="text-muted-foreground hover:text-red-400"
                            >
                              <X size={13} />
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Results */}
              {results && (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: 'Starting Equity', value: formatCurrency(results.summary.start_equity, true) },
                      { label: 'Ending Equity', value: formatCurrency(results.summary.end_equity, true) },
                      { label: 'Equity Growth', value: `+${formatCurrency(results.summary.equity_growth, true)} (${formatPercent(results.summary.equity_growth_pct)})` },
                      { label: 'Total Cashflow', value: formatCurrency(results.summary.total_cashflow, true) },
                      { label: 'Avg Monthly CF', value: formatCurrency(results.summary.avg_monthly_cashflow) },
                    ].map(k => (
                      <div key={k.label} className="bg-card rounded-lg p-4">
                        <div className="text-xs text-muted-foreground">{k.label}</div>
                        <div className="text-sm font-bold text-foreground mt-1">{k.value}</div>
                      </div>
                    ))}
                  </div>

                  <div className="bg-card rounded-lg p-5">
                    <h3 className="text-sm font-semibold mb-4">Projection Chart</h3>
                    <ScenarioAreaChart
                      data={results.months}
                      keys={[
                        { key: 'total_equity', name: 'Equity', color: CHART_COLORS.success },
                        { key: 'total_debt', name: 'Debt', color: CHART_COLORS.danger },
                        { key: 'cumulative_cashflow', name: 'Cumulative Cashflow', color: CHART_COLORS.primary },
                      ]}
                    />
                  </div>
                </>
              )}
            </>
          ) : null}
        </div>
      </div>

      {showCreate && <CreateScenarioModal onClose={() => setShowCreate(false)} onCreated={id => { setSelectedId(id); setShowCreate(false) }} />}
      {showEdit && selected && <EditScenarioModal scenario={selected} onClose={() => setShowEdit(false)} />}
      {(showAddEvent || editingEvent) && selectedId && (
        <EventModal
          scenarioId={selectedId}
          event={editingEvent ?? undefined}
          onClose={() => { setShowAddEvent(false); setEditingEvent(null) }}
        />
      )}
    </div>
  )
}

function CreateScenarioModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const qc = useQueryClient()
  const create = useMutation({
    mutationFn: (data: any) => api.post<Scenario>('/scenarios', data),
    onSuccess: (s) => { qc.invalidateQueries({ queryKey: ['scenarios'] }); onCreated(s.id) },
  })
  const { register, handleSubmit } = useForm({ resolver: zodResolver(scenarioSchema), defaultValues: { projection_years: 10, base_date: new Date().toISOString().slice(0, 10) } })
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-md p-6">
        <h2 className="text-base font-semibold mb-4">New Scenario</h2>
        <form onSubmit={handleSubmit(d => create.mutateAsync(d))} className="space-y-4">
          <div><label className={labelCls}>Name *</label><input {...register('name')} className={inputCls} placeholder="Base Case" /></div>
          <div><label className={labelCls}>Description</label><textarea {...register('description')} className={inputCls} rows={2} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className={labelCls}>Base Date</label><input type="date" {...register('base_date')} className={inputCls} /></div>
            <div><label className={labelCls}>Projection Years</label><input type="number" {...register('projection_years')} className={inputCls} /></div>
          </div>
          <div className="flex gap-3"><button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-border rounded-md text-sm text-muted-foreground">Cancel</button><button type="submit" className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium">Create</button></div>
        </form>
      </div>
    </div>
  )
}

function EditScenarioModal({ scenario, onClose }: { scenario: Scenario; onClose: () => void }) {
  const qc = useQueryClient()
  const update = useMutation({
    mutationFn: (data: z.infer<typeof scenarioSchema>) => api.put(`/scenarios/${scenario.id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['scenarios'] }); qc.invalidateQueries({ queryKey: ['scenarios', scenario.id] }); onClose() },
  })
  const { register, handleSubmit } = useForm({
    resolver: zodResolver(scenarioSchema) as any,
    defaultValues: { name: scenario.name, description: scenario.description ?? '', base_date: scenario.base_date, projection_years: scenario.projection_years },
  })
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-md p-6">
        <h2 className="text-base font-semibold mb-4">Edit Scenario</h2>
        <form onSubmit={handleSubmit(d => update.mutateAsync(d))} className="space-y-4">
          <div><label className={labelCls}>Name *</label><input {...register('name')} className={inputCls} /></div>
          <div><label className={labelCls}>Description</label><textarea {...register('description')} className={inputCls} rows={2} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className={labelCls}>Base Date</label><input type="date" {...register('base_date')} className={inputCls} /></div>
            <div><label className={labelCls}>Projection Years</label><input type="number" {...register('projection_years')} className={inputCls} /></div>
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-border rounded-md text-sm text-muted-foreground">Cancel</button>
            <button type="submit" disabled={update.isPending} className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium disabled:opacity-50">Save</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function EventModal({ scenarioId, event, onClose }: { scenarioId: number; event?: import('@/types').ScenarioEvent; onClose: () => void }) {
  const qc = useQueryClient()
  const isEdit = !!event
  const [eventType, setEventType] = useState(event?.event_type ?? 'buy_property')
  const [date, setDate] = useState(event?.date ?? new Date().toISOString().slice(0, 10))
  const [propertyId, setPropertyId] = useState<number | ''>(event?.property_id ?? '')
  const [params, setParams] = useState<Record<string, string | number>>(() => JSON.parse(event?.parameters_json ?? '{}'))

  const { data: properties } = useQuery({
    queryKey: ['properties'],
    queryFn: () => api.get<{ id: number; address_line1: string; town: string }[]>('/properties'),
  })

  const setParam = (key: string, val: string) =>
    setParams(prev => ({ ...prev, [key]: val === '' ? '' : Number(val) }))

  const save = useMutation({
    mutationFn: () => {
      const body = { event_type: eventType, date, property_id: propertyId || null, parameters: params }
      return isEdit
        ? api.put(`/scenarios/${scenarioId}/events/${event!.id}`, body)
        : api.post(`/scenarios/${scenarioId}/events`, body)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['scenarios', scenarioId] }); onClose() },
  })

  const needsProperty = ['sell_property', 'remortgage', 'vacancy_period', 'rent_change', 'payoff_mortgage'].includes(eventType)

  const numField = (key: string, label: string, placeholder?: string) => (
    <div key={key}>
      <label className={labelCls}>{label}</label>
      <input
        type="number"
        step="any"
        value={params[key] ?? ''}
        onChange={e => setParam(key, e.target.value)}
        placeholder={placeholder}
        className={inputCls}
      />
    </div>
  )

  const renderParams = () => {
    switch (eventType) {
      case 'buy_property':
        return (
          <div className="grid grid-cols-2 gap-3">
            {numField('purchase_price', 'Purchase Price (£)', '200000')}
            {numField('monthly_rent', 'Monthly Rent (£)', '1000')}
            {numField('deposit_percent', 'Deposit (%)', '25')}
            {numField('mortgage_rate', 'Interest Rate (%)', '5.5')}
            {numField('monthly_expenses', 'Monthly Expenses (£)', '200')}
          </div>
        )
      case 'remortgage':
        return numField('new_monthly_payment', 'New Monthly Payment (£)', '600')
      case 'rent_change':
        return (
          <div className="grid grid-cols-2 gap-3">
            {numField('change_percent', 'Change (%)', '5')}
            {numField('new_rent', 'Fixed Rent Amount (£, optional)')}
          </div>
        )
      case 'major_expense':
        return numField('amount', 'Amount (£)', '5000')
      case 'interest_rate_change':
        return numField('change_basis_points', 'Basis Points (e.g. 25 = +0.25%)', '25')
      default:
        return null
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-lg p-6">
        <h2 className="text-base font-semibold mb-4">{isEdit ? 'Edit Event' : 'Add Event'}</h2>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Event Type</label>
              <select value={eventType} onChange={e => { setEventType(e.target.value); setParams({}) }} className={inputCls}>
                {EVENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} />
            </div>
          </div>

          {needsProperty && (
            <div>
              <label className={labelCls}>{eventType === 'rent_change' ? 'Apply to property (blank = all)' : 'Property *'}</label>
              <select value={propertyId} onChange={e => setPropertyId(e.target.value === '' ? '' : Number(e.target.value))} className={inputCls}>
                {eventType === 'rent_change' && <option value="">All properties</option>}
                {properties?.map(p => <option key={p.id} value={p.id}>{p.address_line1}, {p.town}</option>)}
              </select>
            </div>
          )}

          {renderParams()}

          <div className="flex gap-3">
            <button onClick={onClose} className="flex-1 px-4 py-2 border border-border rounded-md text-sm text-muted-foreground">Cancel</button>
            <button onClick={() => save.mutate()} disabled={save.isPending} className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium disabled:opacity-50">
              {isEdit ? 'Save' : 'Add Event'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
