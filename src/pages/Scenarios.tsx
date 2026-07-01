import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Play, X, Trash2, Pencil, Copy, ChevronDown, FileDown } from 'lucide-react'
import { api } from '@/services/api'
import { PageLoader } from '@/components/shared/LoadingSpinner'
import { ScenarioAreaChart, CHART_COLORS } from '@/components/charts'
import { formatCurrency, formatPercent } from '@/utils/currency'
import { formatDate } from '@/utils/dates'
import { calcTransactionCosts, calcMonthlyMortgage } from '@/utils/calculations'
import { useForm, type UseFormRegister } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import type { Scenario, ScenarioResults } from '@/types'
import { ScenarioCompareTable } from '@/components/shared/ScenarioCompareTable'

const scenarioSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  base_date: z.string().min(1),
  projection_years: z.coerce.number().min(1).max(30),
  property_growth_pct: z.coerce.number().min(0).max(20),
  expense_inflation_pct: z.coerce.number().min(0).max(20),
  void_months_per_year: z.coerce.number().min(0).max(12),
})

type ScenarioFormValues = z.infer<typeof scenarioSchema>

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
  { value: 'director_loan_in', label: 'Director Loan In' },
  { value: 'director_loan_repay', label: 'Director Loan Repay' },
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
  const [timelineOpen, setTimelineOpen] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [editingEvent, setEditingEvent] = useState<import('@/types').ScenarioEvent | null>(null)
  const [compareIds, setCompareIds] = useState<Set<number>>(new Set())
  const [compareMode, setCompareMode] = useState(false)

  function toggleCompare(id: number) {
    setCompareIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const { data: selected } = useQuery({
    queryKey: ['scenarios', selectedId],
    queryFn: () => api.get<Scenario>(`/scenarios/${selectedId}`),
    enabled: !!selectedId,
  })

  const deleteScenario = useMutation({
    mutationFn: (id: number) => api.delete(`/scenarios/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['scenarios'] }); setSelectedId(null) },
  })

  const duplicateScenario = useMutation({
    mutationFn: (id: number) => api.post<Scenario>(`/scenarios/${id}/duplicate`, {}),
    onSuccess: (s) => { qc.invalidateQueries({ queryKey: ['scenarios'] }); setSelectedId(s.id) },
  })

  const [stressResults, setStressResults]     = useState<ScenarioResults | null>(null)
  const [activeRateShock, setActiveRateShock] = useState<number | null>(null)
  const [activeRentShock, setActiveRentShock] = useState<number | null>(null)
  const [viewMode, setViewMode]               = useState<'portfolio' | 'property'>('portfolio')
  const [propMetric, setPropMetric]           = useState<'equity' | 'cashflow' | 'cumulative'>('equity')
  const [taxView, setTaxView]                 = useState<'pretax' | 'posttax' | 'both'>('pretax')

  const calculate = useMutation({
    mutationFn: (id: number) => api.post<ScenarioResults>(`/scenarios/${id}/calculate`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['scenarios', selectedId] }); setStressResults(null); setActiveRateShock(null); setActiveRentShock(null); setViewMode('portfolio') },
  })

  const runStress = useMutation({
    mutationFn: ({ id, rateShock, rentShock }: { id: number; rateShock?: number; rentShock?: number }) =>
      api.post<ScenarioResults>(`/scenarios/${id}/stress`, { rateShock, rentShock }),
    onSuccess: (data) => setStressResults(data),
  })

  function handleRateButton(bps: number) {
    const newRate = activeRateShock === bps ? null : bps
    setActiveRateShock(newRate)
    if (newRate !== null || activeRentShock !== null) {
      runStress.mutate({ id: selected!.id, rateShock: newRate ?? undefined, rentShock: activeRentShock ?? undefined })
    } else {
      setStressResults(null)
    }
  }

  function handleRentButton(pct: number) {
    const newRent = activeRentShock === pct ? null : pct
    setActiveRentShock(newRent)
    if (activeRateShock !== null || newRent !== null) {
      runStress.mutate({ id: selected!.id, rateShock: activeRateShock ?? undefined, rentShock: newRent ?? undefined })
    } else {
      setStressResults(null)
    }
  }

  const deleteEvent = useMutation({
    mutationFn: ({ scenarioId, eventId }: { scenarioId: number; eventId: number }) =>
      api.delete(`/scenarios/${scenarioId}/events/${eventId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scenarios', selectedId] }),
  })

  const compareQuery = useQuery({
    queryKey: ['scenarios', 'compare', [...compareIds].sort().join(',')],
    queryFn: () => api.get<{ scenario: { id: number; name: string }; results: ScenarioResults | null }[]>(
      `/scenarios/compare?ids=${[...compareIds].join(',')}`
    ),
    enabled: compareMode && compareIds.size >= 2,
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
            <>
              {scenarios.map(s => (
                <div key={s.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={compareIds.has(s.id)}
                    onChange={() => toggleCompare(s.id)}
                    onClick={e => e.stopPropagation()}
                    className="rounded border-border accent-primary flex-none"
                  />
                  <button
                    onClick={() => { setSelectedId(s.id); setCompareMode(false); setStressResults(null); setActiveRateShock(null); setActiveRentShock(null); setViewMode('portfolio'); setTimelineOpen(false) }}
                    className={`flex-1 text-left px-3 py-2.5 rounded-md text-sm transition-colors ${selectedId === s.id && !compareMode ? 'bg-primary/15 text-primary' : 'bg-card text-foreground hover:bg-accent'}`}
                  >
                    <div className="font-medium">{s.name}</div>
                    <div className="text-xs text-muted-foreground">{s.projection_years}yr projection</div>
                  </button>
                </div>
              ))}
              {compareIds.size >= 2 && (
                <button
                  onClick={() => setCompareMode(true)}
                  className="w-full mt-1 px-3 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium"
                >
                  Compare ({compareIds.size})
                </button>
              )}
            </>
          )}
        </div>

        {/* Detail / Compare panel */}
        <div className="col-span-3 space-y-5">
          {compareMode ? (
            <ScenarioCompareTable
              data={compareQuery.data ?? []}
              isLoading={compareQuery.isLoading}
              onExit={() => setCompareMode(false)}
              onExport={() => window.open(`/brief/compare?ids=${[...compareIds].join(',')}`, '_blank')}
            />
          ) : !selectedId ? (
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
                    {results && (
                      <button onClick={() => window.open(`/brief/scenario/${selected.id}`, '_blank')} title="PDF brief" className="flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-md text-xs text-muted-foreground hover:bg-accent">
                        <FileDown size={12} /> PDF
                      </button>
                    )}
                    <button onClick={() => setShowEdit(true)} title="Edit scenario" className="px-3 py-1.5 border border-border rounded-md text-xs text-muted-foreground hover:bg-accent">
                      <Pencil size={12} />
                    </button>
                    <button onClick={() => duplicateScenario.mutate(selected.id)} disabled={duplicateScenario.isPending} title="Duplicate scenario" className="px-3 py-1.5 border border-border rounded-md text-xs text-muted-foreground hover:bg-accent disabled:opacity-50">
                      <Copy size={12} />
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
              <div className="bg-card rounded-lg">
                <button
                  type="button"
                  onClick={() => setTimelineOpen(o => !o)}
                  className="w-full flex items-center justify-between px-5 py-4 text-left"
                >
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold">Events Timeline</h3>
                    <span className="text-xs text-muted-foreground">({selected.events?.length ?? 0})</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={e => { e.stopPropagation(); setTimelineOpen(true); setShowAddEvent(true) }}
                      onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); setTimelineOpen(true); setShowAddEvent(true) } }}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-muted text-foreground rounded-md text-xs hover:bg-accent"
                    >
                      <Plus size={12} /> Add Event
                    </span>
                    <ChevronDown
                      size={15}
                      className={`text-muted-foreground transition-transform duration-200 ${timelineOpen ? 'rotate-180' : ''}`}
                    />
                  </div>
                </button>
                {timelineOpen && (
                  <div className="px-5 pb-5">
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
                )}
              </div>

              {/* Results */}
              {results && (() => {
                const stressLabel = [
                  activeRateShock ? `+${activeRateShock / 100}% rates` : null,
                  activeRentShock ? `${activeRentShock}% rent` : null,
                ].filter(Boolean).join(', ')

                const PROP_COLORS = Object.values(CHART_COLORS)
                let chartData: Record<string, string | number | undefined>[]
                let chartKeys: { key: string; name: string; color: string; dash?: boolean }[]

                if (viewMode === 'property' && results.property_series?.length) {
                  const mKey = propMetric === 'equity' ? 'equity' : propMetric === 'cumulative' ? 'cumulative_cashflow' : 'monthly_cashflow'
                  const propByDate = new Map(
                    results.property_series!.map(ps => [
                      ps.property_id,
                      new Map(ps.months.map(pm => [pm.date, pm]))
                    ])
                  )
                  chartData = results.months.map(m => {
                    const row: Record<string, string | number | undefined> = { date: m.date }
                    for (const ps of results.property_series!) {
                      const snap = propByDate.get(ps.property_id)?.get(m.date)
                      row[`prop_${ps.property_id}`] = snap?.[mKey]
                    }
                    return row
                  })
                  chartKeys = results.property_series.map((ps, i) => ({
                    key: `prop_${ps.property_id}`,
                    name: ps.label,
                    color: PROP_COLORS[i % PROP_COLORS.length],
                  }))
                } else {
                  chartData = results.months.map((m, i) => ({
                    ...m,
                    ...(stressResults ? { stressed_cashflow: stressResults.months[i]?.cumulative_cashflow } : {}),
                  }))
                  const showPre = taxView === 'pretax' || taxView === 'both'
                  const showPost = taxView === 'posttax' || taxView === 'both'
                  chartKeys = [
                    { key: 'total_equity',        name: 'Equity',              color: CHART_COLORS.success },
                    { key: 'total_debt',          name: 'Debt',                color: CHART_COLORS.danger  },
                    ...(showPre  ? [{ key: 'cumulative_cashflow',         name: taxView === 'both' ? 'Cumulative CF (pre-tax)' : 'Cumulative Cashflow', color: CHART_COLORS.primary }] : []),
                    ...(showPost ? [{ key: 'cumulative_cashflow_posttax', name: 'Cumulative CF (post-tax)', color: CHART_COLORS.warning, dash: taxView === 'both' }] : []),
                    ...(stressResults ? [{ key: 'stressed_cashflow', name: `Cashflow (${stressLabel})`, color: CHART_COLORS.warning, dash: true }] : []),
                  ]
                }

                const btnCls = (active: boolean) =>
                  `px-2.5 py-1 text-xs rounded-md border transition-colors ${active ? 'bg-primary/15 border-primary/60 text-primary' : 'border-border text-muted-foreground hover:bg-accent'}`

                return (
                  <>
                    {/* View + stress controls */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-muted-foreground">View:</span>
                      <button onClick={() => setViewMode('portfolio')} className={btnCls(viewMode === 'portfolio')}>Portfolio</button>
                      <button onClick={() => setViewMode('property')}  className={btnCls(viewMode === 'property')}>Per Property</button>
                      {viewMode === 'property' && results.property_series && (
                        <>
                          <span className="text-xs text-muted-foreground ml-2">Show:</span>
                          <button onClick={() => setPropMetric('equity')}     className={btnCls(propMetric === 'equity')}>Equity</button>
                          <button onClick={() => setPropMetric('cashflow')}   className={btnCls(propMetric === 'cashflow')}>Monthly CF</button>
                          <button onClick={() => setPropMetric('cumulative')} className={btnCls(propMetric === 'cumulative')}>Cumulative CF</button>
                        </>
                      )}
                      {viewMode === 'portfolio' && (
                        <>
                          <span className="text-xs text-muted-foreground ml-2">Tax:</span>
                          <button onClick={() => setTaxView('pretax')}  className={btnCls(taxView === 'pretax')}>Pre-tax</button>
                          <button onClick={() => setTaxView('posttax')} className={btnCls(taxView === 'posttax')}>Post-tax</button>
                          <button onClick={() => setTaxView('both')}    className={btnCls(taxView === 'both')}>Both</button>
                        </>
                      )}
                    </div>

                    {/* Stress test buttons (portfolio view only) */}
                    {viewMode === 'portfolio' && <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-muted-foreground">Rates:</span>
                      {[100, 200, 300].map(bps => (
                        <button
                          key={bps}
                          onClick={() => handleRateButton(bps)}
                          disabled={runStress.isPending}
                          className={`px-2.5 py-1 text-xs rounded-md border transition-colors disabled:opacity-50 ${
                            activeRateShock === bps
                              ? 'bg-warning/20 border-warning/60 text-warning'
                              : 'border-border text-muted-foreground hover:bg-accent'
                          }`}
                        >+{bps / 100}%</button>
                      ))}
                      <span className="text-xs font-semibold text-muted-foreground ml-2">Rent:</span>
                      {[-10, -20].map(pct => (
                        <button
                          key={pct}
                          onClick={() => handleRentButton(pct)}
                          disabled={runStress.isPending}
                          className={`px-2.5 py-1 text-xs rounded-md border transition-colors disabled:opacity-50 ${
                            activeRentShock === pct
                              ? 'bg-warning/20 border-warning/60 text-warning'
                              : 'border-border text-muted-foreground hover:bg-accent'
                          }`}
                        >{pct}%</button>
                      ))}
                      {(activeRateShock !== null || activeRentShock !== null) && (
                        <button
                          onClick={() => { setActiveRateShock(null); setActiveRentShock(null); setStressResults(null) }}
                          className="px-2.5 py-1 text-xs rounded-md border border-border text-muted-foreground hover:bg-accent ml-1"
                        >Clear</button>
                      )}
                    </div>}

                    {/* Lender ICR breach warning (portfolio view only) */}
                    {viewMode === 'portfolio' && stressResults && (stressResults.summary.months_below_icr ?? 0) > 0 && (
                      <div className="flex items-center gap-2 px-4 py-2.5 rounded-md bg-warning/10 border border-warning/30 text-sm text-warning">
                        ⚠ {stressResults.summary.months_below_icr} month{stressResults.summary.months_below_icr !== 1 ? 's' : ''} breach the lender ICR floor under {stressLabel}. Min ICR: {(stressResults.summary.min_icr ?? 0).toFixed(0)}%.
                      </div>
                    )}

                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { label: 'Starting Equity',  value: formatCurrency(results.summary.start_equity, true), tooltip: 'Total equity across all properties at the start of the projection — current market value minus outstanding mortgage debt.' },
                        { label: 'Ending Equity',    value: formatCurrency(results.summary.end_equity, true),   tooltip: 'Projected total equity at the end of the projection period, after property value growth and mortgage amortisation.' },
                        { label: 'Equity Growth',    value: `+${formatCurrency(results.summary.equity_growth, true)} (${formatPercent(results.summary.equity_growth_pct)})`, tooltip: 'Net increase in equity over the projection: property appreciation plus principal repaid, minus any new debt taken on.' },
                        { label: 'Total Cashflow',   value: formatCurrency(results.summary.total_cashflow, true), tooltip: 'Cumulative net cashflow over the full projection period — rent received minus mortgage payments, expenses, and one-off acquisition costs.' },
                        { label: 'Avg Monthly CF',   value: formatCurrency(results.summary.avg_monthly_cashflow), tooltip: 'Average monthly net cashflow across all properties and all months in the projection. Lower than the ending figure because the early years hold fewer properties.' },
                        { label: 'Ending Monthly CF', value: formatCurrency(results.summary.ending_monthly_cashflow ?? 0), tooltip: 'Net monthly cashflow in the final month of the projection — the steady-state income once the full portfolio is built and mortgages have amortised. This is the figure to compare against an income goal. Re-run the projection if this reads £0 on an older scenario.' },
                        { label: 'Ending CF (post-tax)', value: formatCurrency(results.summary.ending_monthly_cashflow_posttax ?? 0), tooltip: 'Final-month net monthly cashflow after income tax (S24 personal or corporation tax for Ltd), using the global Tax settings. The real spendable FI figure. Set your structure in Business Overview → Tax settings.' },
                        { label: 'Tax paid (total)', value: formatCurrency(results.summary.total_tax_paid ?? 0, true), tooltip: 'Total income tax plus CGT paid across the whole projection. £0 means no tax settings were applied (re-run the projection after setting your tax structure).' },
                        { label: 'Cover Ratio',      value: (results.summary.min_cover_ratio ?? 0).toFixed(2), tooltip: 'Lowest ratio of total rent to the actual mortgage payment recorded in any month. An informal cashflow-cover figure — not a lender affordability test (see Lender ICR for that).' },
                        { label: 'Lender ICR',       value: `${(results.summary.min_icr ?? 0).toFixed(0)}%`, tooltip: 'Lowest lender Interest Coverage Ratio recorded in any month — rent ÷ a stressed interest-only payment (the higher of pay-rate+2% or a 5.5% floor). Real lenders require 125% (personal, basic-rate) or 145% (higher-rate personal / Ltd company).' },
                        { label: 'ICR Breaches',     value: `${results.summary.months_below_icr ?? '—'} mo`, tooltip: 'Number of months where the lender ICR fell below the required floor. A high count under stress scenarios suggests vulnerability to rate rises.' },
                      ].map(k => (
                        <KpiCard key={k.label} label={k.label} value={k.value} tooltip={k.tooltip} />
                      ))}
                    </div>

                    {/* Per-property: no data guard */}
                    {viewMode === 'property' && !results.property_series && (
                      <p className="text-sm text-muted-foreground py-4 text-center">Re-run the projection to enable per-property view.</p>
                    )}

                    <div className="bg-card rounded-lg p-5">
                      <h3 className="text-sm font-semibold mb-4">Projection Chart</h3>
                      <ScenarioAreaChart data={chartData} keys={chartKeys} />
                      {/* Best / Worst banner */}
                      {viewMode === 'property' && results.property_series && results.property_series.length >= 2 && (() => {
                        const mKey = propMetric === 'equity' ? 'equity' : propMetric === 'cumulative' ? 'cumulative_cashflow' : 'monthly_cashflow'
                        const ranked = [...results.property_series]
                          .filter(ps => ps.months.length > 0)
                          .sort((a, b) => (b.months.at(-1)?.[mKey] ?? 0) - (a.months.at(-1)?.[mKey] ?? 0))
                        const best  = ranked[0]
                        const worst = ranked.at(-1)
                        if (!best || !worst || best === worst) return null
                        return (
                          <p className="text-xs text-muted-foreground mt-3">
                            Best: <span className="text-foreground font-medium">{best.label}</span>
                            {' · '}
                            Worst: <span className="text-foreground font-medium">{worst.label}</span>
                          </p>
                        )
                      })()}
                    </div>
                  </>
                )
              })()}
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

function KpiCard({ label, value, tooltip }: { label: string; value: string; tooltip: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="bg-card rounded-lg p-4">
      <div className="relative">
        <span
          className="text-xs text-muted-foreground underline decoration-dotted decoration-muted-foreground/50 cursor-default"
          onMouseEnter={() => setShow(true)}
          onMouseLeave={() => setShow(false)}
        >
          {label}
        </span>
        {show && (
          <div className="absolute bottom-full left-0 mb-2 w-56 rounded-md bg-popover border border-border text-xs text-popover-foreground p-2 shadow-lg z-50 whitespace-normal leading-relaxed">
            {tooltip}
          </div>
        )}
      </div>
      <div className="text-sm font-bold text-foreground mt-1">{value}</div>
    </div>
  )
}

function AssumptionsFields({ register }: { register: UseFormRegister<ScenarioFormValues> }) {
  return (
    <div className="border-t border-border pt-3 mt-1 space-y-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Growth & Assumptions</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Property Growth (% p.a.)</label>
          <input type="number" step="0.1" {...register('property_growth_pct')} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Expense Inflation (% p.a.)</label>
          <input type="number" step="0.1" {...register('expense_inflation_pct')} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Avg Void (months/year)</label>
          <input type="number" step="0.1" {...register('void_months_per_year')} className={inputCls} />
        </div>
        <div className="flex items-end pb-2">
          <p className="text-xs text-muted-foreground">Void reduces effective rent. Rent growth uses rent_change events.</p>
        </div>
      </div>
    </div>
  )
}

function serializeScenarioPayload(d: z.infer<typeof scenarioSchema>) {
  const { property_growth_pct, expense_inflation_pct, void_months_per_year, ...rest } = d
  return { ...rest, assumptions_json: JSON.stringify({ property_growth_pct, expense_inflation_pct, void_months_per_year }) }
}

function parseAssumptions(json?: string | null) {
  const a = JSON.parse(json ?? '{}')
  return {
    property_growth_pct:   a.property_growth_pct   ?? 3.0,
    expense_inflation_pct: a.expense_inflation_pct ?? 2.5,
    void_months_per_year:  a.void_months_per_year  ?? 1,
  }
}

function CreateScenarioModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const qc = useQueryClient()
  const create = useMutation({
    mutationFn: (data: any) => api.post<Scenario>('/scenarios', data),
    onSuccess: (s) => { qc.invalidateQueries({ queryKey: ['scenarios'] }); onCreated(s.id) },
  })
  const { register, handleSubmit } = useForm<ScenarioFormValues>({
    resolver: zodResolver(scenarioSchema) as any,
    defaultValues: { projection_years: 10, base_date: new Date().toISOString().slice(0, 10), ...parseAssumptions(null) },
  })
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-md p-6">
        <h2 className="text-base font-semibold mb-4">New Scenario</h2>
        <form onSubmit={handleSubmit(d => create.mutateAsync(serializeScenarioPayload(d as any)))} className="space-y-4">
          <div><label className={labelCls}>Name *</label><input {...register('name')} className={inputCls} placeholder="Base Case" /></div>
          <div><label className={labelCls}>Description</label><textarea {...register('description')} className={inputCls} rows={2} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className={labelCls}>Base Date</label><input type="date" {...register('base_date')} className={inputCls} /></div>
            <div><label className={labelCls}>Projection Years</label><input type="number" {...register('projection_years')} className={inputCls} /></div>
          </div>
          <AssumptionsFields register={register} />
          <div className="flex gap-3"><button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-border rounded-md text-sm text-muted-foreground">Cancel</button><button type="submit" className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium">Create</button></div>
        </form>
      </div>
    </div>
  )
}

function EditScenarioModal({ scenario, onClose }: { scenario: Scenario; onClose: () => void }) {
  const qc = useQueryClient()
  const update = useMutation({
    mutationFn: (data: any) => api.put(`/scenarios/${scenario.id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['scenarios'] }); qc.invalidateQueries({ queryKey: ['scenarios', scenario.id] }); onClose() },
  })
  const { register, handleSubmit } = useForm<ScenarioFormValues>({
    resolver: zodResolver(scenarioSchema) as any,
    defaultValues: {
      name: scenario.name,
      description: scenario.description ?? '',
      base_date: scenario.base_date,
      projection_years: scenario.projection_years,
      ...parseAssumptions((scenario as any).assumptions_json),
    },
  })
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-md p-6">
        <h2 className="text-base font-semibold mb-4">Edit Scenario</h2>
        <form onSubmit={handleSubmit(d => update.mutateAsync(serializeScenarioPayload(d as any)))} className="space-y-4">
          <div><label className={labelCls}>Name *</label><input {...register('name')} className={inputCls} /></div>
          <div><label className={labelCls}>Description</label><textarea {...register('description')} className={inputCls} rows={2} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className={labelCls}>Base Date</label><input type="date" {...register('base_date')} className={inputCls} /></div>
            <div><label className={labelCls}>Projection Years</label><input type="number" {...register('projection_years')} className={inputCls} /></div>
          </div>
          <AssumptionsFields register={register} />
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

  const deriveMortgageType = (p: Record<string, string | number>) => {
    if (Number(p.deposit_percent) >= 100) return 'cash'
    if (p.interest_only) return 'interest_only'
    return 'repayment'
  }
  const [mortgageType, setMortgageType] = useState(() =>
    deriveMortgageType(JSON.parse(event?.parameters_json ?? '{}'))
  )

  const { data: properties } = useQuery({
    queryKey: ['properties'],
    queryFn: () => api.get<{ id: number; address_line1: string; town: string }[]>('/properties'),
  })

  const setParam = (key: string, val: string) =>
    setParams(prev => ({ ...prev, [key]: val === '' ? '' : Number(val) }))

  const handleMortgageTypeChange = (type: string) => {
    setMortgageType(type)
    if (type === 'cash') {
      setParams(prev => ({ ...prev, interest_only: 0, deposit_percent: 100 }))
    } else {
      setParams(prev => ({ ...prev, interest_only: type === 'interest_only' ? 1 : 0 }))
    }
  }

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
      case 'buy_property': {
        const isCash = mortgageType === 'cash'
        return (
          <div className="grid grid-cols-2 gap-3">
            {numField('purchase_price', 'Purchase Price (£)', '200000')}
            {numField('monthly_rent', 'Monthly Rent (£)', '1000')}
            <div className="col-span-2">
              <label className={labelCls}>Purchase Type</label>
              <select
                value={mortgageType}
                onChange={e => handleMortgageTypeChange(e.target.value)}
                className={inputCls}
              >
                <option value="repayment">Repayment Mortgage</option>
                <option value="interest_only">Interest Only Mortgage</option>
                <option value="cash">Cash Purchase</option>
              </select>
            </div>
            {!isCash && numField('deposit_percent', 'Deposit (%)', '25')}
            {!isCash && numField('mortgage_rate', 'Interest Rate (%)', '5.5')}
            {!isCash && numField('mortgage_term_years', 'Mortgage Term (years)', '25')}
            {numField('monthly_expenses', 'Monthly Expenses (£)', '200')}
            {numField('legal_fees', 'Legal & Survey Fees (£)', '2000')}
            {numField('refurb_costs', 'Refurbishment Costs (£)', '0')}
            {(() => {
              const price = Number(params.purchase_price) || 0
              if (!price) return null
              const { lbtt, ads, total } = calcTransactionCosts(
                price,
                Number(params.legal_fees ?? 2000),
                Number(params.refurb_costs ?? 0)
              )
              return (
                <div className="col-span-2 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  LBTT: <strong className="text-foreground">£{lbtt.toLocaleString()}</strong>
                  {' · '}ADS (8%): <strong className="text-foreground">£{ads.toLocaleString()}</strong>
                  {' · '}Total acquisition costs: <strong className="text-foreground">£{total.toLocaleString()}</strong>
                </div>
              )
            })()}
          </div>
        )
      }
      case 'remortgage': {
        const isIO = params.interest_only
        const previewRate = Number(params.new_rate) || 0
        const previewDebt = Number(params.new_balance) || 0
        const previewTerm = Number(params.new_term_years) || 25
        const previewPayment = previewRate && previewDebt
          ? calcMonthlyMortgage(previewDebt, previewRate, isIO ? 0 : previewTerm * 12)
          : null
        return (
          <div className="grid grid-cols-2 gap-3">
            {numField('new_rate', 'New Interest Rate (%)', '4.5')}
            {numField('new_term_years', 'New Term (years)', '25')}
            {numField('new_balance', 'New Loan Amount (£)')}
            {numField('arrangement_fee', 'Arrangement Fee (£)', '0')}
            <div className="col-span-2">
              <label className={labelCls}>Mortgage Type</label>
              <select
                value={String(params.interest_only ?? 0)}
                onChange={e => setParam('interest_only', e.target.value)}
                className={inputCls}
              >
                <option value="0">Repayment</option>
                <option value="1">Interest Only</option>
              </select>
            </div>
            {previewPayment != null && (
              <div className="col-span-2 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Estimated new payment: <strong className="text-foreground">{formatCurrency(previewPayment)}/mo</strong>
              </div>
            )}
          </div>
        )
      }
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
      case 'director_loan_in':
        return numField('amount', 'Loan Amount (£)', '25000')
      case 'director_loan_repay':
        return numField('amount', 'Repayment Amount (£)', '5000')
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
              <select value={eventType} onChange={e => { setEventType(e.target.value); setParams({}); setMortgageType('repayment') }} className={inputCls}>
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
