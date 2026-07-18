import { ScenarioAreaChart, CHART_COLORS } from '@/components/charts'
import { deriveMetrics, buildDiff, COMPARE_ROWS, winnerIndex } from '@/components/shared/ScenarioCompareTable'
import { briefRiskMetrics } from '@/utils/briefMetrics'
import { formatCurrency, formatPercent } from '@/utils/currency'
import { formatDate } from '@/utils/dates'
import type { ScenarioResults, RiskFactor } from '@/types'

export interface BriefItem {
  scenario: { id: number; name: string; base_date: string; projection_years: number }
  // Nullable for comparison only: a scenario that has never been run still earns a column, marked
  // "(no run)", exactly as the on-screen table shows it. The single-scenario brief requires results
  // and its caller guards for that.
  results: ScenarioResults | null
}

const BAND_CLS: Record<string, string> = {
  low: 'bg-emerald-100 text-emerald-700',
  medium: 'bg-amber-100 text-amber-700',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-gray-200 rounded-md px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-sm font-semibold text-gray-900 mt-0.5 tabular-nums">{value}</div>
    </div>
  )
}

function ScenarioKpis({ results }: { results: ScenarioResults }) {
  const s = results.summary
  return (
    <div className="grid grid-cols-4 gap-2">
      <Kpi label="Start Equity" value={formatCurrency(s.start_equity, true)} />
      <Kpi label="End Equity" value={formatCurrency(s.end_equity, true)} />
      <Kpi label="Equity Growth" value={`${formatCurrency(s.equity_growth, true)} (${formatPercent(s.equity_growth_pct)})`} />
      <Kpi label="Total Cashflow" value={formatCurrency(s.total_cashflow, true)} />
      <Kpi label="End Debt" value={formatCurrency(results.months[results.months.length - 1]?.total_debt ?? 0, true)} />
      <Kpi label="Ending Monthly CF" value={formatCurrency(s.ending_monthly_cashflow ?? 0)} />
      <Kpi label="Ending CF (post-tax)" value={formatCurrency(s.ending_monthly_cashflow_posttax ?? s.ending_monthly_cashflow ?? 0)} />
      <Kpi label="Total Tax Paid" value={formatCurrency(s.total_tax_paid ?? 0, true)} />
    </div>
  )
}

function RisksBlock({ results, topRisks }: { results: ScenarioResults; topRisks: RiskFactor[] }) {
  const r = briefRiskMetrics(results)
  return (
    <div className="grid grid-cols-2 gap-5">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Scenario risks</h3>
        <div className="grid grid-cols-2 gap-2">
          <Kpi label="Min Lender ICR" value={r.minIcr > 0 ? `${r.minIcr.toFixed(0)}%` : '—'} />
          <Kpi label="ICR Breaches" value={`${r.breaches} mo`} />
          <Kpi label="Liquidity Trough" value={formatCurrency(r.liquidityTrough, true)} />
          <Kpi label="Peak LTV" value={`${r.peakLtv.toFixed(1)}%`} />
        </div>
      </div>
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Top current-portfolio risks</h3>
        <div className="space-y-1.5">
          {topRisks.map(f => (
            <div key={f.key} className="flex items-start gap-2 text-xs">
              <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${BAND_CLS[f.band] ?? 'bg-gray-100 text-gray-600'}`}>{f.band}</span>
              <span className="text-gray-700"><span className="font-medium text-gray-900">{f.label}</span> (L{f.likelihood}×I{f.impact}) — {f.rationale}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex items-end justify-between border-b border-gray-200 pb-3">
      <div>
        <h1 className="text-xl font-bold text-gray-900">{title}</h1>
        <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>
      </div>
      <div className="text-right text-[11px] text-gray-500">
        <div className="font-semibold text-gray-700">Portfolio Intelligence</div>
        <div>Generated {formatDate(new Date().toISOString())}</div>
      </div>
    </div>
  )
}

export function ScenarioBrief({ items, topRisks, targetEquity = 0 }: { items: BriefItem[]; topRisks: RiskFactor[]; targetEquity?: number }) {
  // Any multi-scenario brief is a comparison. This was previously `=== 2`, so exporting a
  // comparison of three or more silently rendered a single-scenario brief of the first one.
  const isCompare = items.length >= 2

  return (
    <div className="light bg-white text-gray-900 w-[794px] p-8 space-y-5">
      {isCompare ? (
        <CompareBrief items={items} topRisks={topRisks} targetEquity={targetEquity} />
      ) : (
        <SingleBrief item={items[0]} topRisks={topRisks} />
      )}
      <div className="border-t border-gray-200 pt-2 text-[10px] text-gray-400 text-center">
        Generated by Portfolio Intelligence — figures are projections, not advice.
      </div>
    </div>
  )
}

function SingleBrief({ item, topRisks }: { item: BriefItem; topRisks: RiskFactor[] }) {
  const { scenario, results } = item
  if (!results) return null   // caller (ScenarioBriefPage) already renders an empty-state instead
  const chartData = results.months as unknown as Record<string, string | number | undefined>[]
  const keys = [
    { key: 'total_equity', name: 'Equity', color: CHART_COLORS.success },
    { key: 'total_debt', name: 'Debt', color: CHART_COLORS.danger },
    { key: 'cumulative_cashflow', name: 'Cumulative Cashflow', color: CHART_COLORS.primary },
  ]
  return (
    <>
      <Header title="Scenario Brief" subtitle={`${scenario.name} · base ${formatDate(scenario.base_date)} · ${scenario.projection_years}-year projection`} />
      <ScenarioKpis results={results} />
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Projection</h3>
        <ScenarioAreaChart data={chartData} keys={keys} />
      </div>
      <RisksBlock results={results} topRisks={topRisks} />
    </>
  )
}

function CompareBrief({ items, topRisks, targetEquity }: { items: BriefItem[]; topRisks: RiskFactor[]; targetEquity: number }) {
  const metrics = items.map(it => deriveMetrics(it.results, targetEquity))

  // The page is a fixed 794px, so unlike the on-screen table there is nothing to scroll into.
  // Tighten type and padding as columns are added so 5-6 scenarios still fit the width.
  const n = items.length
  const cell = n >= 5 ? 'text-[10px] px-1.5' : n === 4 ? 'text-[11px] px-2' : 'text-xs px-3'
  const head = n >= 5 ? 'text-[10px] px-1.5' : n === 4 ? 'text-[11px] px-2' : 'text-sm px-3'

  // The narrative diff is inherently pairwise, so it only applies to an exact pair — same rule the
  // on-screen table uses.
  const pairDiff = n === 2 && metrics[0] && metrics[1] ? buildDiff(metrics[0], metrics[1]) : null
  const firstWithResults = items.find(it => it.results)

  return (
    <>
      <Header
        title="Scenario Comparison"
        subtitle={n === 2
          ? `${items[0].scenario.name} vs ${items[1].scenario.name}`
          : `${n} scenarios · ${items.map(it => it.scenario.name).join(' · ')}`}
      />

      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="text-left py-2 pr-3 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Metric</th>
            {items.map(it => (
              <th key={it.scenario.id} className={`text-right py-2 font-semibold text-gray-900 ${head}`}>
                {it.scenario.name}
                {!it.results && <span className="ml-1 font-normal text-gray-400">(no run)</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {COMPARE_ROWS.map(row => {
            const winner = row.bestHighest !== null ? winnerIndex(metrics, row.key, row.bestHighest) : -1
            return (
              <tr key={row.key} className="border-b border-gray-100">
                <td className="py-1.5 pr-3 text-[11px] text-gray-500 whitespace-nowrap">{row.label}</td>
                {metrics.map((m, i) => {
                  const isWinner = winner === i && m !== null
                  return (
                    <td
                      key={i}
                      className={`py-1.5 text-right tabular-nums whitespace-nowrap ${cell} ${
                        isWinner ? 'bg-emerald-50 text-emerald-700 font-semibold' : 'text-gray-900'
                      }`}
                    >
                      {m ? row.format(m[row.key] as number) : '—'}
                      {isWinner && <span className="ml-1 opacity-70">★</span>}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>

      <p className="text-[10px] text-gray-400">★ Best in row</p>

      {pairDiff && (
        <div className="border border-gray-200 rounded-md p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{items[1].scenario.name} vs {items[0].scenario.name}</p>
          <p className="text-sm text-gray-800 mt-1">
            {pairDiff.length > 0
              ? `${items[1].scenario.name} delivers ${pairDiff.join(', ')} vs ${items[0].scenario.name}.`
              : 'No material differences between these two scenarios.'}
          </p>
        </div>
      )}

      {firstWithResults && <RisksBlock results={firstWithResults.results!} topRisks={topRisks} />}
    </>
  )
}
