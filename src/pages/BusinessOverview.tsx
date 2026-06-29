import { useState, useEffect } from 'react'
import { useDashboard } from '@/hooks/useDashboard'
import { useFinancialSummary } from '@/hooks/useFinancials'
import { useSettings, useUpdateSettings } from '@/hooks/useSettings'
import { useScorecard } from '@/hooks/useScorecard'
import { useRiskHeatmap } from '@/hooks/useRiskHeatmap'
import { useInsights } from '@/hooks/useInsights'
import { KPICard } from '@/components/shared/KPICard'
import { PageLoader } from '@/components/shared/LoadingSpinner'
import { RiskHeatmap } from '@/components/shared/RiskHeatmap'
import { InsightsList } from '@/components/shared/InsightsList'
import { ScorecardRadar } from '@/components/charts'
import { formatCurrency, formatPercent } from '@/utils/currency'
import type { TaxSettings, ScoreItem, ScoreRating } from '@/types'

const RATING_CLS: Record<ScoreRating, string> = {
  strong: 'bg-emerald-500/15 text-emerald-400',
  fair:   'bg-amber-500/15 text-amber-400',
  weak:   'bg-red-500/15 text-red-400',
}
const RATING_BAR: Record<ScoreRating, string> = {
  strong: 'bg-emerald-500',
  fair:   'bg-amber-500',
  weak:   'bg-red-500',
}

function ScoreCard({ s }: { s: ScoreItem }) {
  const [show, setShow] = useState(false)
  return (
    <div className="bg-card rounded-lg p-4 relative"
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground underline decoration-dotted decoration-muted-foreground/40 cursor-default">{s.label}</span>
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${RATING_CLS[s.rating]}`}>{s.rating}</span>
      </div>
      <div className="text-2xl font-bold text-foreground mt-1">{s.value}<span className="text-sm text-muted-foreground font-normal">/100</span></div>
      <div className="h-1.5 rounded-full bg-muted mt-2 overflow-hidden">
        <div className={`h-full rounded-full ${RATING_BAR[s.rating]}`} style={{ width: `${s.value}%` }} />
      </div>
      {show && (
        <div className="absolute top-full left-0 mt-1 w-64 rounded-md bg-popover border border-border text-xs text-popover-foreground p-2 shadow-lg z-50 whitespace-normal leading-relaxed">
          {s.detail}
        </div>
      )}
    </div>
  )
}

function ScorecardSection() {
  const { data: sc, isLoading } = useScorecard()
  if (isLoading || !sc) return null
  const radarData = sc.scores.map(s => ({ label: s.label, value: s.value }))
  return (
    <div className="bg-card rounded-lg p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">Portfolio scorecard</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Six transparent 0–100 scores. Hover a card for the formula. Recomputes when your data changes.</p>
        </div>
        <div className="text-right">
          <div className="text-3xl font-bold text-foreground">{sc.overall.value}<span className="text-base text-muted-foreground font-normal">/100</span></div>
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${RATING_CLS[sc.overall.rating]}`}>{sc.overall.rating}</span>
        </div>
      </div>
      <div className="grid grid-cols-12 gap-4 items-center">
        <div className="col-span-12 lg:col-span-5"><ScorecardRadar data={radarData} /></div>
        <div className="col-span-12 lg:col-span-7 grid grid-cols-3 gap-3">
          {sc.scores.map(s => <ScoreCard key={s.key} s={s} />)}
        </div>
      </div>
    </div>
  )
}

function RiskSection() {
  const { data: risk, isLoading } = useRiskHeatmap()
  if (isLoading || !risk) return null
  return (
    <div className="bg-card rounded-lg p-6 space-y-4">
      <div>
        <h3 className="text-base font-semibold">Risk heatmap</h3>
        <p className="text-xs text-muted-foreground mt-0.5">Likelihood × impact per risk factor, scored from your portfolio facts. Hover a marker; recomputes when data changes.</p>
      </div>
      <RiskHeatmap factors={risk.factors} />
    </div>
  )
}

function InsightsSection() {
  const { data, isLoading } = useInsights()
  if (isLoading || !data) return null
  return (
    <div className="bg-card rounded-lg p-6 space-y-4">
      <div>
        <h3 className="text-base font-semibold">Key insights</h3>
        <p className="text-xs text-muted-foreground mt-0.5">Plain-English read on your portfolio, citing the numbers. Recomputes when data changes.</p>
      </div>
      <InsightsList insights={data.insights} />
    </div>
  )
}

const taxInputCls = 'w-full px-3 py-2 rounded-md bg-input border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary'
const taxLabelCls = 'block text-xs font-medium text-muted-foreground mb-1'

function TaxSettingsCard() {
  const { data: settings } = useSettings()
  const update = useUpdateSettings()
  const [form, setForm] = useState<TaxSettings | null>(null)

  useEffect(() => { if (settings) setForm(settings) }, [settings])
  if (!form) return null

  const set = <K extends keyof TaxSettings>(k: K, v: TaxSettings[K]) => setForm({ ...form, [k]: v })
  const num = (k: keyof TaxSettings) => (
    <input type="number" step="0.1" value={form[k] as number}
      onChange={e => set(k, Number(e.target.value) as never)} className={taxInputCls} />
  )

  return (
    <div className="bg-card rounded-lg p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">Tax settings</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Applied to all What-If projections and goal pathways. Drives the post-tax cashflow.</p>
        </div>
        <button
          onClick={() => update.mutate(form)}
          disabled={update.isPending}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium disabled:opacity-50"
        >
          {update.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="col-span-2">
          <label className={taxLabelCls}>Ownership structure</label>
          <select value={form.ownership} onChange={e => set('ownership', e.target.value as TaxSettings['ownership'])} className={taxInputCls}>
            <option value="personal">Personal (S24 — individual landlord)</option>
            <option value="ltd">Limited company (corporation tax)</option>
          </select>
        </div>

        {form.ownership === 'personal' ? (
          <>
            <div><label className={taxLabelCls}>Marginal income-tax rate (%)</label>{num('personal_marginal_rate_pct')}</div>
            <div><label className={taxLabelCls}>S24 interest credit (%)</label>{num('s24_credit_rate_pct')}</div>
            <div><label className={taxLabelCls}>CGT rate (%)</label>{num('cgt_rate_pct')}</div>
            <div><label className={taxLabelCls}>CGT annual exemption (£)</label>{num('cgt_annual_exempt')}</div>
            <div><label className={taxLabelCls}>Selling costs (% of sale)</label>{num('selling_costs_pct')}</div>
          </>
        ) : (
          <>
            <div><label className={taxLabelCls}>Corporation tax rate (%)</label>{num('corp_tax_rate_pct')}</div>
            <div><label className={taxLabelCls}>Selling costs (% of sale)</label>{num('selling_costs_pct')}</div>
            <div className="col-span-4 text-xs text-muted-foreground">Company gains are taxed via corporation tax (no CGT allowance). Mortgage interest is fully deductible.</div>
          </>
        )}
      </div>
    </div>
  )
}

export default function BusinessOverview() {
  const { data: dash, isLoading } = useDashboard()
  const { data: fin } = useFinancialSummary()

  if (isLoading) return <PageLoader />

  const kpis = dash?.kpis
  const annualIncome = (kpis?.monthly_gross_income ?? 0) * 12
  const annualNet = (kpis?.monthly_net_cashflow ?? 0) * 12

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Business Overview</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Company-wide statistics and performance</p>
      </div>

      <ScorecardSection />

      <RiskSection />

      <InsightsSection />

      <div className="grid grid-cols-4 gap-4">
        <KPICard label="Total Assets" value={formatCurrency(kpis?.total_portfolio_value ?? 0, true)} subtext="Property portfolio value" variant="success" />
        <KPICard label="Total Debt" value={formatCurrency(kpis?.total_debt ?? 0, true)} subtext="Outstanding mortgages" variant="warning" />
        <KPICard label="Net Worth (Property)" value={formatCurrency(kpis?.total_equity ?? 0, true)} subtext="Assets minus debt" />
        <KPICard label="LTV Ratio" value={formatPercent(kpis?.ltv_ratio ?? 0)} subtext="Loan to value" variant={kpis?.ltv_ratio && kpis.ltv_ratio > 75 ? 'warning' : 'default'} />
      </div>

      <div className="grid grid-cols-4 gap-4">
        <KPICard label="Monthly Passive Income" value={formatCurrency(kpis?.monthly_gross_income ?? 0)} subtext="Gross rental income" />
        <KPICard label="Monthly Net Income" value={formatCurrency(kpis?.monthly_net_cashflow ?? 0)} variant={(kpis?.monthly_net_cashflow ?? 0) >= 0 ? 'success' : 'danger'} />
        <KPICard label="Annual Gross Income" value={formatCurrency(annualIncome, true)} />
        <KPICard label="Annual Net Income" value={formatCurrency(annualNet, true)} variant={annualNet >= 0 ? 'success' : 'danger'} />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <KPICard label="Portfolio Gross Yield" value={formatPercent(kpis?.annual_gross_yield ?? 0)} subtext="Annual rent / portfolio value" />
        <KPICard label="Properties Owned" value={kpis?.properties_count ?? 0} subtext={`${kpis?.tenants_active ?? 0} tenanted`} />
        <KPICard label="Occupancy Rate" value={formatPercent(kpis?.occupancy_rate ?? 0)} />
      </div>

      <TaxSettingsCard />

      <div className="bg-card rounded-lg p-6 space-y-4">
        <h3 className="text-base font-semibold">Income by Property</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground border-b border-border">
              <th className="text-left pb-2">Property</th>
              <th className="text-right pb-2">Monthly Rent</th>
              <th className="text-right pb-2">Annual Rent</th>
              <th className="text-right pb-2">Value</th>
              <th className="text-right pb-2">Yield</th>
            </tr>
          </thead>
          <tbody>
            {fin?.income_by_property?.map(p => (
              <tr key={p.property_id} className="border-b border-border/40">
                <td className="py-2.5">{p.address}</td>
                <td className="py-2.5 text-right">{formatCurrency(p.monthly_rent)}</td>
                <td className="py-2.5 text-right">{formatCurrency(p.monthly_rent * 12)}</td>
                <td className="py-2.5 text-right text-muted-foreground">{formatCurrency(p.current_value, true)}</td>
                <td className="py-2.5 text-right text-green-400 font-medium">{formatPercent(p.gross_yield)}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="pt-3">Total</td>
              <td className="pt-3 text-right">{formatCurrency(kpis?.monthly_gross_income ?? 0)}</td>
              <td className="pt-3 text-right">{formatCurrency(annualIncome)}</td>
              <td className="pt-3 text-right text-muted-foreground">{formatCurrency(kpis?.total_portfolio_value ?? 0, true)}</td>
              <td className="pt-3 text-right text-green-400">{formatPercent(kpis?.annual_gross_yield ?? 0)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
