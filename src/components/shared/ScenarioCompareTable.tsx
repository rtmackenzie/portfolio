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
}

function deriveMetrics(results: ScenarioResults | null) {
  if (!results) return null
  const { summary, months } = results
  const peakLtv = months.reduce((max, m) => {
    const ltv = m.total_value > 0 ? (m.total_debt / m.total_value) * 100 : 0
    return Math.max(max, ltv)
  }, 0)
  return {
    end_equity:        summary.end_equity,
    equity_growth_pct: summary.equity_growth_pct,
    total_cashflow:    summary.total_cashflow,
    avg_monthly_cf:    summary.avg_monthly_cashflow,
    peak_ltv:          Math.round(peakLtv * 10) / 10,
    final_properties:  months[months.length - 1]?.property_count ?? 0,
  }
}

type Metrics = NonNullable<ReturnType<typeof deriveMetrics>>

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
  { label: 'Final Properties',   key: 'final_properties',  format: v => formatNumber(v),            bestHighest: null  },
]

function winnerIndex(metrics: (Metrics | null)[], key: keyof Metrics, bestHighest: boolean): number {
  let best: number | null = null
  let idx = -1
  metrics.forEach((m, i) => {
    if (!m) return
    const v = m[key] as number
    if (best === null || (bestHighest ? v > best : v < best)) {
      best = v
      idx = i
    }
  })
  return idx
}

export function ScenarioCompareTable({ data, isLoading, onExit }: Props) {
  const allMetrics = data.map(d => deriveMetrics(d.results))

  return (
    <div className="bg-card rounded-lg p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Scenario Comparison</h2>
        <button
          onClick={onExit}
          className="px-3 py-1.5 border border-border rounded-md text-xs text-muted-foreground hover:bg-accent"
        >
          × Exit Compare
        </button>
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

      <p className="text-xs text-muted-foreground">
        ★ Best in column &nbsp;·&nbsp; Run a projection on each scenario to populate results
      </p>
    </div>
  )
}
