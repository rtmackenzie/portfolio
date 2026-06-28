import {
  AreaChart as ReAreaChart, Area, BarChart as ReBarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
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
  [key: string]: string | number
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
  // Upper: 5% headroom, rounded to nearest £50k
  const yMax = Math.ceil(rawMax * 1.05 / 50000) * 50000
  // Lower: cap negative space at 10% of the positive max so a small cashflow dip
  // doesn't compress the whole chart. Large genuine negatives are clipped at the cap.
  const negCap = rawMax > 0 ? -(rawMax * 0.1) : -10000
  const yMin = rawMin < 0 ? Math.floor(Math.max(rawMin, negCap) / 10000) * 10000 : 0

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
          <Area key={k.key} type="monotone" dataKey={k.key} name={k.name} stroke={k.color} fill={k.dash ? 'none' : `url(#grad-${k.key})`} strokeWidth={2} strokeDasharray={k.dash ? '5 5' : undefined} allowDataOverflow />
        ))}
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
