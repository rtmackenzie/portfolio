import { useState } from 'react'
import { FileDown } from 'lucide-react'
import type { ScenarioResults } from '@/types'
import { formatCurrency, formatPercent, formatNumber } from '@/utils/currency'

interface CompareResult {
  scenario: { id: number; name: string }
  results: ScenarioResults | null
}

interface Props {
  data: CompareResult[]
  isLoading: boolean
  onExit: () => void
  onExport?: () => void
}

export function deriveMetrics(results: ScenarioResults | null, targetEquity: number) {
  if (!results) return null
  const { summary, months } = results
  const peakLtv = months.reduce((max, m) => {
    const ltv = m.total_value > 0 ? (m.total_debt / m.total_value) * 100 : 0
    return Math.max(max, ltv)
  }, 0)
  // Time-to-target: first month total_equity reaches the (shared) target.
  // NaN = no target set; Infinity = target never reached within the projection.
  let monthsToTarget: number
  if (!targetEquity || targetEquity <= 0) {
    monthsToTarget = NaN
  } else {
    const idx = months.findIndex(m => m.total_equity >= targetEquity)
    monthsToTarget = idx === -1 ? Infinity : idx
  }
  return {
    end_equity:        summary.end_equity,
    equity_growth_pct: summary.equity_growth_pct,
    total_cashflow:    summary.total_cashflow,
    avg_monthly_cf:    summary.avg_monthly_cashflow,
    peak_ltv:          Math.round(peakLtv * 10) / 10,
    min_dscr:          summary.min_dscr ?? 0,
    liquidity:         summary.min_cumulative_cashflow ?? 0,
    months_to_target:  monthsToTarget,
    final_properties:  months[months.length - 1]?.property_count ?? 0,
  }
}

type Metrics = NonNullable<ReturnType<typeof deriveMetrics>>

function formatMonths(v: number): string {
  if (Number.isNaN(v)) return '—'
  if (!Number.isFinite(v)) return 'Not reached'
  const years = Math.floor(v / 12)
  const months = v % 12
  if (years === 0) return `${months}mo`
  if (months === 0) return `${years}y`
  return `${years}y ${months}mo`
}

const ROWS: {
  label: string
  key: keyof Metrics
  format: (v: number) => string
  bestHighest: boolean | null  // null = no winner highlighted
}[] = [
  { label: 'End Equity',         key: 'end_equity',        format: v => formatCurrency(v),         bestHighest: true  },
  { label: 'Equity Growth',      key: 'equity_growth_pct', format: v => formatPercent(v),           bestHighest: true  },
  { label: 'Total Cashflow',     key: 'total_cashflow',    format: v => formatCurrency(v),          bestHighest: true  },
  { label: 'Avg Monthly CF',     key: 'avg_monthly_cf',    format: v => formatCurrency(v),          bestHighest: true  },
  { label: 'Peak LTV',           key: 'peak_ltv',          format: v => `${v.toFixed(1)}%`,         bestHighest: false },
  { label: 'Min DSCR (risk)',    key: 'min_dscr',          format: v => `${v.toFixed(2)}×`,         bestHighest: true  },
  { label: 'Liquidity (min cash)', key: 'liquidity',       format: v => formatCurrency(v),          bestHighest: true  },
  { label: 'Time to Target',     key: 'months_to_target',  format: formatMonths,                    bestHighest: false },
  { label: 'Final Properties',   key: 'final_properties',  format: v => formatNumber(v),            bestHighest: null  },
]

function winnerIndex(metrics: (Metrics | null)[], key: keyof Metrics, bestHighest: boolean): number {
  let best: number | null = null
  let idx = -1
  metrics.forEach((m, i) => {
    if (!m) return
    const v = m[key] as number
    if (!Number.isFinite(v)) return  // "Not reached" / unset never wins
    if (best === null || (bestHighest ? v > best : v < best)) {
      best = v
      idx = i
    }
  })
  return idx
}

function signedCurrency(delta: number): string {
  const sign = delta >= 0 ? '+' : '−'
  return `${sign}${formatCurrency(Math.abs(delta), true)}`
}

export function buildDiff(a: Metrics, b: Metrics): string[] {
  const parts: string[] = []

  const eq = b.end_equity - a.end_equity
  if (Math.abs(eq) > 1000)
    parts.push(`${signedCurrency(eq)} equity`)

  const cf = b.avg_monthly_cf - a.avg_monthly_cf
  if (Math.abs(cf) > 50)
    parts.push(`${signedCurrency(cf)}/mo cashflow`)

  const tc = b.total_cashflow - a.total_cashflow
  if (Math.abs(tc) > 1000)
    parts.push(`${signedCurrency(tc)} total cashflow`)

  const eg = b.equity_growth_pct - a.equity_growth_pct
  if (Math.abs(eg) > 0.5)
    parts.push(`${eg >= 0 ? '+' : ''}${eg.toFixed(1)}% equity growth`)

  const ltv = b.peak_ltv - a.peak_ltv
  if (Math.abs(ltv) > 0.5)
    parts.push(`${ltv >= 0 ? '+' : ''}${ltv.toFixed(1)}pp LTV`)

  const dscr = b.min_dscr - a.min_dscr
  if (Math.abs(dscr) >= 0.1)
    parts.push(`${dscr >= 0 ? '+' : '−'}${Math.abs(dscr).toFixed(2)}× min DSCR`)

  const liq = b.liquidity - a.liquidity
  if (Math.abs(liq) > 1000)
    parts.push(`${signedCurrency(liq)} liquidity`)

  if (Number.isFinite(a.months_to_target) && Number.isFinite(b.months_to_target)) {
    const tt = b.months_to_target - a.months_to_target
    if (Math.abs(tt) >= 1)
      parts.push(`${tt >= 0 ? '+' : '−'}${Math.abs(tt)} mo to target`)
  }

  const props = b.final_properties - a.final_properties
  if (Math.abs(props) >= 1)
    parts.push(`${props >= 0 ? '+' : ''}${props} propert${Math.abs(props) === 1 ? 'y' : 'ies'}`)

  return parts
}

export function ScenarioCompareTable({ data, isLoading, onExit, onExport }: Props) {
  const [targetInput, setTargetInput] = useState('')
  const targetEquity = Number(targetInput) || 0
  const allMetrics = data.map(d => deriveMetrics(d.results, targetEquity))

  return (
    <div className="bg-card rounded-lg p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Scenario Comparison</h2>
        <div className="flex items-center gap-2">
          {onExport && (
            <button
              onClick={onExport}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-md text-xs text-muted-foreground hover:bg-accent"
            >
              <FileDown size={12} /> Export PDF
            </button>
          )}
          <button
            onClick={onExit}
            className="px-3 py-1.5 border border-border rounded-md text-xs text-muted-foreground hover:bg-accent"
          >
            × Exit Compare
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="target-equity" className="text-xs font-semibold text-muted-foreground">
          Target equity (for time-to-target):
        </label>
        <div className="relative">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">£</span>
          <input
            id="target-equity"
            type="number"
            inputMode="numeric"
            placeholder="e.g. 500000"
            value={targetInput}
            onChange={e => setTargetInput(e.target.value)}
            className="w-40 pl-5 pr-2 py-1 text-xs rounded-md border border-border bg-background text-foreground tabular-nums"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading comparison…</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2.5 pr-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider w-36">
                  Metric
                </th>
                {data.map(d => (
                  <th key={d.scenario.id} className="text-right py-2.5 px-3 font-semibold text-foreground">
                    {d.scenario.name}
                    {!d.results && (
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">(no run)</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map(row => {
                const winner = row.bestHighest !== null
                  ? winnerIndex(allMetrics, row.key, row.bestHighest)
                  : -1

                return (
                  <tr key={row.key} className="border-b border-border/50 hover:bg-accent/30">
                    <td className="py-2.5 pr-4 text-xs font-medium text-muted-foreground whitespace-nowrap">
                      {row.label}
                    </td>
                    {allMetrics.map((m, i) => {
                      const isWinner = winner === i && m !== null
                      return (
                        <td
                          key={i}
                          className={`py-2.5 px-3 text-right tabular-nums whitespace-nowrap rounded ${
                            isWinner
                              ? 'bg-emerald-500/15 text-emerald-400 font-semibold'
                              : 'text-foreground'
                          }`}
                        >
                          {m ? row.format(m[row.key] as number) : '—'}
                          {isWinner && <span className="ml-1.5 text-xs opacity-70">★</span>}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {data.length === 2 && allMetrics[0] && allMetrics[1] && (() => {
        const parts = buildDiff(allMetrics[0]!, allMetrics[1]!)
        const baseline = data[0].scenario.name
        const variant  = data[1].scenario.name
        return (
          <div className="border border-border rounded-md p-4 space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {variant} vs {baseline}
            </p>
            <p className="text-sm text-foreground leading-relaxed">
              {parts.length > 0
                ? `${variant} delivers ${parts.join(', ')} vs ${baseline}.`
                : 'No material differences between these two scenarios.'}
            </p>
          </div>
        )
      })()}

      <p className="text-xs text-muted-foreground">
        ★ Best in column &nbsp;·&nbsp; Run a projection on each scenario to populate results
      </p>
    </div>
  )
}
