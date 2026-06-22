import { useDashboard } from '@/hooks/useDashboard'
import { useFinancialSummary } from '@/hooks/useFinancials'
import { KPICard } from '@/components/shared/KPICard'
import { PageLoader } from '@/components/shared/LoadingSpinner'
import { formatCurrency, formatPercent } from '@/utils/currency'

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
