import {
  AreaChart as ReAreaChart, Area, BarChart as ReBarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, Line,
  RadarChart as ReRadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  ScatterChart as ReScatterChart, Scatter, ZAxis
} from 'recharts'
import { formatCurrency, formatPercent } from '@/utils/currency'
import { formatMonthYear } from '@/utils/dates'

export const CHART_COLORS = {
  primary: 'hsl(220, 70%, 60%)',
  success: 'hsl(142, 70%, 45%)',
  warning: 'hsl(38, 92%, 50%)',
  danger: 'hsl(0, 72%, 51%)',
  muted: 'hsl(220, 15%, 40%)',
  purple: 'hsl(262, 60%, 60%)',
}

const tooltipStyle = {
  backgroundColor: 'var(--color-card)',
  border: '1px solid var(--color-border)',
  borderRadius: '6px',
  color: 'var(--color-foreground)',
  fontSize: '12px',
}

const axisStyle = { fill: 'var(--color-muted-foreground)', fontSize: 11 }
const gridStyle = { stroke: 'var(--color-border)', strokeDasharray: '3 3' }

interface ChartData {
  [key: string]: string | number | undefined
}

// Recharts formatter types are overly broad — cast to any avoids false TS errors
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const currencyFormatter: any = (value: number) => formatCurrency(value)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const monthLabelFormatter: any = (label: string) => formatMonthYear(label)

const yAxisFormatter = (v: number) => {
  if (v === 0) return '£0'
  const k = v / 1000
  if (k >= 1) return `£${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}k`
  return `£${v}`
}

export function IncomeAreaChart({ data }: { data: { month: string; gross_income: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ReAreaChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
        <defs>
          <linearGradient id="incomeGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={CHART_COLORS.primary} stopOpacity={0.3} />
            <stop offset="95%" stopColor={CHART_COLORS.primary} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid {...gridStyle} />
        <XAxis dataKey="month" tick={axisStyle} tickFormatter={formatMonthYear} interval={1} />
        <YAxis tick={axisStyle} tickFormatter={yAxisFormatter} width={50} />
        <Tooltip contentStyle={tooltipStyle} formatter={currencyFormatter} labelFormatter={monthLabelFormatter} />
        <Area type="monotone" dataKey="gross_income" stroke={CHART_COLORS.primary} fill="url(#incomeGrad)" strokeWidth={2} name="Income" />
      </ReAreaChart>
    </ResponsiveContainer>
  )
}

export function ScorecardRadar({ data }: { data: { label: string; value: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ReRadarChart data={data} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
        <PolarGrid stroke="var(--color-border)" />
        <PolarAngleAxis dataKey="label" tick={{ fill: 'var(--color-muted-foreground)', fontSize: 11 }} />
        <PolarRadiusAxis domain={[0, 100]} tick={{ fill: 'var(--color-muted-foreground)', fontSize: 9 }} tickCount={5} />
        <Radar dataKey="value" stroke={CHART_COLORS.primary} fill={CHART_COLORS.primary} fillOpacity={0.35} name="Score" />
        <Tooltip contentStyle={tooltipStyle} />
      </ReRadarChart>
    </ResponsiveContainer>
  )
}

export function CashflowBarChart({ data }: { data: { month: string; income: number; expenses: number; net: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ReBarChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
        <CartesianGrid {...gridStyle} />
        <XAxis dataKey="month" tick={axisStyle} tickFormatter={formatMonthYear} interval={1} />
        <YAxis tick={axisStyle} tickFormatter={yAxisFormatter} width={50} />
        <Tooltip contentStyle={tooltipStyle} formatter={currencyFormatter} labelFormatter={monthLabelFormatter} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: 'var(--color-muted-foreground)' }} />
        <Bar dataKey="income" fill={CHART_COLORS.success} name="Gross Income" radius={[2, 2, 0, 0]} />
        <Bar dataKey="net" fill={CHART_COLORS.primary} name="Net Income" radius={[2, 2, 0, 0]} />
      </ReBarChart>
    </ResponsiveContainer>
  )
}

export function ExpenseDonutChart({ data }: { data: { category: string; total: number }[] }) {
  const colors = [CHART_COLORS.primary, CHART_COLORS.warning, CHART_COLORS.success, CHART_COLORS.purple, CHART_COLORS.danger, CHART_COLORS.muted]
  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie data={data} dataKey="total" nameKey="category" cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={3}>
          {data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
        </Pie>
        <Tooltip contentStyle={tooltipStyle} formatter={currencyFormatter} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: 'var(--color-muted-foreground)' }} />
      </PieChart>
    </ResponsiveContainer>
  )
}

export function ScenarioAreaChart({ data, keys }: { data: ChartData[]; keys: { key: string; name: string; color: string; dash?: boolean }[] }) {
  const allValues = data.flatMap(d => keys.map(k => Number(d[k.key] ?? 0)))
  const rawMax = allValues.length > 0 ? Math.max(...allValues) : 100000
  const rawMin = allValues.length > 0 ? Math.min(...allValues) : 0
  // Adaptive tick rounding based on data magnitude
  const upperStep = rawMax >= 100000 ? 50000 : rawMax >= 10000 ? 5000 : rawMax >= 1000 ? 500 : 100
  const lowerStep = rawMax >= 100000 ? 10000 : rawMax >= 10000 ? 1000 : rawMax >= 1000 ? 500 : 100
  const yMax = Math.ceil(rawMax * 1.05 / upperStep) * upperStep
  const negCap = rawMax > 0 ? -(rawMax * 0.1) : -lowerStep
  const yMin = rawMin < 0 ? Math.floor(Math.max(rawMin, negCap) / lowerStep) * lowerStep : 0

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ReAreaChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
        <defs>
          {keys.map(k => (
            <linearGradient key={k.key} id={`grad-${k.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={k.color} stopOpacity={0.25} />
              <stop offset="95%" stopColor={k.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid {...gridStyle} />
        <XAxis dataKey="date" tick={axisStyle} interval="preserveStartEnd" tickFormatter={formatMonthYear} />
        <YAxis
          tick={axisStyle}
          tickFormatter={yAxisFormatter}
          width={55}
          domain={[yMin, yMax]}
          allowDataOverflow
        />
        <Tooltip contentStyle={tooltipStyle} formatter={currencyFormatter} labelFormatter={monthLabelFormatter} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: 'var(--color-muted-foreground)' }} />
        {keys.map(k => (
          <Area key={k.key} type="monotone" dataKey={k.key} name={k.name} stroke={k.color} fill={k.dash ? 'none' : `url(#grad-${k.key})`} strokeWidth={2} strokeDasharray={k.dash ? '5 5' : undefined} />
        ))}
      </ReAreaChart>
    </ResponsiveContainer>
  )
}

// Monte-Carlo fan chart (§P1-5b / Appendix A.2): P10-P90 shaded band (P25-P75 darker), a solid
// P50 line, and the deterministic central case overlaid as a sanity check — persistent
// divergence between P50 and the central line would mean the distributions are mis-centred.
// Built as stacked delta-areas (Recharts has no native band primitive): an invisible base area
// up to P10, then three visible delta-areas (P10→P25, P25→P75, P75→P90) stacked on top.
export interface FanChartRow { date: string; p10: number; p25: number; p50: number; p75: number; p90: number; central?: number }

export function ScenarioFanChart({ data }: { data: FanChartRow[] }) {
  const rows = data.map(d => ({
    date: d.date,
    p10: d.p10,
    band_p10_p25: d.p25 - d.p10,
    band_p25_p75: d.p75 - d.p25,
    band_p75_p90: d.p90 - d.p75,
    p50: d.p50,
    central: d.central,
  }))
  const allValues = data.flatMap(d => [d.p10, d.p90, d.central ?? d.p50])
  const rawMax = allValues.length > 0 ? Math.max(...allValues) : 100000
  const rawMin = allValues.length > 0 ? Math.min(...allValues) : 0
  const upperStep = rawMax >= 100000 ? 50000 : rawMax >= 10000 ? 5000 : rawMax >= 1000 ? 500 : 100
  const lowerStep = rawMax >= 100000 ? 10000 : rawMax >= 10000 ? 1000 : rawMax >= 1000 ? 500 : 100
  const yMax = Math.ceil(rawMax * 1.05 / upperStep) * upperStep
  const negCap = rawMax > 0 ? -(rawMax * 0.1) : -lowerStep
  const yMin = rawMin < 0 ? Math.floor(Math.max(rawMin, negCap) / lowerStep) * lowerStep : 0

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ReAreaChart data={rows} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
        <CartesianGrid {...gridStyle} />
        <XAxis dataKey="date" tick={axisStyle} interval="preserveStartEnd" tickFormatter={formatMonthYear} />
        <YAxis tick={axisStyle} tickFormatter={yAxisFormatter} width={55} domain={[yMin, yMax]} allowDataOverflow />
        <Tooltip contentStyle={tooltipStyle} formatter={currencyFormatter} labelFormatter={monthLabelFormatter} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: 'var(--color-muted-foreground)' }} />
        <Area dataKey="p10" stackId="band" stroke="none" fill="none" name="P10 floor" legendType="none" isAnimationActive={false} />
        <Area dataKey="band_p10_p25" stackId="band" stroke="none" fill={CHART_COLORS.primary} fillOpacity={0.15} name="P10–P90 range" isAnimationActive={false} />
        <Area dataKey="band_p25_p75" stackId="band" stroke="none" fill={CHART_COLORS.primary} fillOpacity={0.35} name="P25–P75 range" isAnimationActive={false} />
        <Area dataKey="band_p75_p90" stackId="band" stroke="none" fill={CHART_COLORS.primary} fillOpacity={0.15} legendType="none" isAnimationActive={false} />
        <Line type="monotone" dataKey="p50" stroke={CHART_COLORS.primary} strokeWidth={2} dot={false} name="Median (P50)" />
        <Line type="monotone" dataKey="central" stroke={CHART_COLORS.success} strokeWidth={2} strokeDasharray="5 5" dot={false} name="Central case" />
      </ReAreaChart>
    </ResponsiveContainer>
  )
}

export function ValuationAreaChart({ data }: { data: { valuation_date: string; total_value: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ReAreaChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
        <defs>
          <linearGradient id="valueGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={CHART_COLORS.purple} stopOpacity={0.3} />
            <stop offset="95%" stopColor={CHART_COLORS.purple} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid {...gridStyle} />
        <XAxis dataKey="valuation_date" tick={axisStyle} tickFormatter={v => formatMonthYear(v)} />
        <YAxis tick={axisStyle} tickFormatter={yAxisFormatter} width={55} />
        <Tooltip contentStyle={tooltipStyle} formatter={currencyFormatter} labelFormatter={monthLabelFormatter} />
        <Area type="monotone" dataKey="total_value" stroke={CHART_COLORS.purple} fill="url(#valueGrad)" strokeWidth={2} name="Portfolio Value" />
      </ReAreaChart>
    </ResponsiveContainer>
  )
}

export interface RiskFrontierPoint {
  label: string
  risk: number       // x-axis: risk score, 0-100 — lower is always better
  y: number          // y-axis: months-to-goal or ending income, direction set by yBetterWhen
  feasible: boolean
  bindingDetail?: string
}

// A point is Pareto-dominated when another point is at least as good on both axes and
// strictly better on one — dominance direction on y depends on the chosen metric (months to
// goal: lower is better; ending income: higher is better). Small (<=4 points typically), so a
// plain O(n^2) comparison is fine — no need for a fancier frontier algorithm.
function computeParetoEfficient(points: RiskFrontierPoint[], yBetterWhen: 'lower' | 'higher'): boolean[] {
  return points.map((p, i) => {
    return !points.some((q, j) => {
      if (i === j) return false
      const qBetterOrEqualRisk = q.risk <= p.risk
      const qBetterOrEqualY = yBetterWhen === 'lower' ? q.y <= p.y : q.y >= p.y
      const qStrictlyBetterSomewhere = q.risk < p.risk || (yBetterWhen === 'lower' ? q.y < p.y : q.y > p.y)
      return qBetterOrEqualRisk && qBetterOrEqualY && qStrictlyBetterSomewhere
    })
  })
}

// Risk-vs-speed frontier (§P2-8 Appendix B.2): one point per generated strategy, Pareto-efficient
// set highlighted, infeasible plans greyed with their binding constraint in the tooltip — the
// artefact that shows the whole risk/speed trade-off in one glance.
export function RiskFrontierChart({ points, yLabel, yBetterWhen }: { points: RiskFrontierPoint[]; yLabel: string; yBetterWhen: 'lower' | 'higher' }) {
  const efficient = computeParetoEfficient(points, yBetterWhen)
  const data = points.map((p, i) => ({ ...p, efficient: efficient[i] }))

  return (
    <ResponsiveContainer width="100%" height={280}>
      <ReScatterChart margin={{ top: 20, right: 20, bottom: 10, left: 10 }}>
        <CartesianGrid {...gridStyle} />
        <XAxis type="number" dataKey="y" name={yLabel} tick={axisStyle} label={{ value: yLabel, position: 'insideBottom', offset: -5, fill: 'var(--color-muted-foreground)', fontSize: 11 }} />
        <YAxis type="number" dataKey="risk" name="Risk score" domain={[0, 100]} tick={axisStyle} label={{ value: 'Risk score (0-100)', angle: -90, position: 'insideLeft', fill: 'var(--color-muted-foreground)', fontSize: 11 }} />
        <ZAxis range={[120, 120]} />
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const p = payload[0].payload as RiskFrontierPoint & { efficient: boolean }
            return (
              <div style={tooltipStyle} className="p-2">
                <div className="font-medium">{p.label}{p.efficient && <span className="text-success ml-1">★ efficient</span>}</div>
                <div>Risk score: {p.risk}</div>
                <div>{yLabel}: {p.y}</div>
                {!p.feasible && <div className="text-danger mt-1">Infeasible{p.bindingDetail ? ` — ${p.bindingDetail}` : ''}</div>}
              </div>
            )
          }}
        />
        <Scatter data={data} shape={(props: unknown) => {
          const { cx, cy, payload } = props as { cx: number; cy: number; payload: RiskFrontierPoint & { efficient: boolean } }
          const fill = !payload.feasible ? CHART_COLORS.muted : payload.efficient ? CHART_COLORS.success : CHART_COLORS.primary
          const opacity = !payload.feasible ? 0.4 : 1
          return <circle cx={cx} cy={cy} r={payload.efficient ? 7 : 5} fill={fill} fillOpacity={opacity} stroke={fill} strokeWidth={payload.efficient ? 2 : 0} />
        }} />
      </ReScatterChart>
    </ResponsiveContainer>
  )
}
