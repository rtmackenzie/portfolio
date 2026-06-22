import { Building2, TrendingUp, Users, AlertTriangle, ShieldAlert, Wrench, Wallet, BarChart3 } from 'lucide-react'
import { useDashboard } from '@/hooks/useDashboard'
import { KPICard } from '@/components/shared/KPICard'
import { PageLoader } from '@/components/shared/LoadingSpinner'
import { IncomeAreaChart, ExpenseDonutChart, ValuationAreaChart } from '@/components/charts'
import { formatCurrency, formatPercent } from '@/utils/currency'
import { fromNow } from '@/utils/dates'

const EVENT_ICONS: Record<string, string> = {
  property_created: '🏠', property_updated: '✏️',
  tenant_added: '👤', tenant_removed: '👤',
  mortgage_added: '🏦', maintenance_logged: '🔧', maintenance_completed: '✅',
  certificate_added: '📋', rent_received: '💰', valuation_added: '📊',
  opportunity_added: '🔍', opportunity_stage_changed: '📌',
}

export default function Dashboard() {
  const { data, isLoading } = useDashboard()

  if (isLoading) return <PageLoader />

  const kpis = data?.kpis
  const cashflowPositive = (kpis?.monthly_net_cashflow ?? 0) >= 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Portfolio overview and key metrics</p>
      </div>

      {/* Row 1: Portfolio KPIs */}
      <div className="grid grid-cols-4 gap-4">
        <KPICard
          label="Portfolio Value"
          value={formatCurrency(kpis?.total_portfolio_value ?? 0, true)}
          subtext={`${kpis?.properties_count ?? 0} properties`}
          icon={<Building2 size={16} />}
        />
        <KPICard
          label="Total Equity"
          value={formatCurrency(kpis?.total_equity ?? 0, true)}
          subtext={`LTV ${formatPercent(kpis?.ltv_ratio ?? 0)}`}
          icon={<Wallet size={16} />}
          variant={kpis?.ltv_ratio && kpis.ltv_ratio > 75 ? 'warning' : 'success'}
        />
        <KPICard
          label="Monthly Net Cashflow"
          value={formatCurrency(kpis?.monthly_net_cashflow ?? 0)}
          subtext={`Gross: ${formatCurrency(kpis?.monthly_gross_income ?? 0)}/mo`}
          icon={<TrendingUp size={16} />}
          variant={cashflowPositive ? 'success' : 'danger'}
        />
        <KPICard
          label="Gross Yield"
          value={formatPercent(kpis?.annual_gross_yield ?? 0)}
          subtext={`${kpis?.tenants_active ?? 0} active tenants`}
          icon={<BarChart3 size={16} />}
        />
      </div>

      {/* Row 2: Operational KPIs */}
      <div className="grid grid-cols-4 gap-4">
        <KPICard
          label="Occupancy Rate"
          value={formatPercent(kpis?.occupancy_rate ?? 0)}
          subtext={`${kpis?.tenants_active ?? 0} of ${kpis?.properties_count ?? 0} let`}
          icon={<Users size={16} />}
          variant={kpis?.occupancy_rate && kpis.occupancy_rate < 80 ? 'warning' : 'default'}
        />
        <KPICard
          label="Outstanding Debt"
          value={formatCurrency(kpis?.total_debt ?? 0, true)}
          subtext="Mortgage balances"
          icon={<Building2 size={16} />}
        />
        <KPICard
          label="Certs Expiring"
          value={kpis?.certificates_expiring_soon ?? 0}
          subtext={`${kpis?.certificates_expired ?? 0} already expired`}
          icon={<ShieldAlert size={16} />}
          variant={(kpis?.certificates_expiring_soon ?? 0) > 0 ? 'warning' : 'default'}
        />
        <KPICard
          label="Open Maintenance"
          value={kpis?.maintenance_open ?? 0}
          subtext="Pending or in progress"
          icon={<Wrench size={16} />}
          variant={(kpis?.maintenance_open ?? 0) > 2 ? 'warning' : 'default'}
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-3 gap-4">
        {/* Income chart */}
        <div className="col-span-2 bg-card rounded-lg p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-foreground mb-1">Monthly Rental Income</h3>
          <p className="text-xs text-muted-foreground mb-4">Last 12 months — received & expected income</p>
          {data?.income_chart && data.income_chart.length > 0 ? (
            <IncomeAreaChart data={data.income_chart} />
          ) : (
            <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">
              No payment data yet
            </div>
          )}
        </div>

        {/* Expense breakdown */}
        <div className="bg-card rounded-lg p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-foreground mb-1">Expense Breakdown</h3>
          <p className="text-xs text-muted-foreground mb-4">Monthly by category</p>
          {data?.expense_breakdown && data.expense_breakdown.length > 0 ? (
            <ExpenseDonutChart data={data.expense_breakdown} />
          ) : (
            <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">
              No expense data yet
            </div>
          )}
        </div>
      </div>

      {/* Value trend + Activity */}
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 bg-card rounded-lg p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-foreground mb-1">Portfolio Value Trend</h3>
          <p className="text-xs text-muted-foreground mb-4">Historical valuations</p>
          {data?.value_chart && data.value_chart.length > 0 ? (
            <ValuationAreaChart data={data.value_chart} />
          ) : (
            <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">
              Add property valuations to see trend
            </div>
          )}
        </div>

        {/* Activity feed */}
        <div className="bg-card rounded-lg p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-foreground mb-4">Recent Activity</h3>
          <div className="space-y-3 overflow-y-auto max-h-[220px]">
            {data?.recent_activity && data.recent_activity.length > 0 ? (
              data.recent_activity.map(entry => (
                <div key={entry.id} className="flex gap-3">
                  <span className="text-base flex-shrink-0 mt-0.5">
                    {EVENT_ICONS[entry.event_type] ?? '📌'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-foreground leading-snug">{entry.description}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{fromNow(entry.event_date)}</p>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">No activity yet</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
