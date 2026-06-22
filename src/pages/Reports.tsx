import { useQuery } from '@tanstack/react-query'
import { FileText, Download } from 'lucide-react'
import { api } from '@/services/api'
import { PageLoader } from '@/components/shared/LoadingSpinner'
import { formatCurrency, formatPercent } from '@/utils/currency'
import { formatDate } from '@/utils/dates'

export default function Reports() {
  const { data, isLoading } = useQuery({
    queryKey: ['reports', 'portfolio-summary'],
    queryFn: () => api.get<any>('/reports/portfolio-summary'),
  })

  if (isLoading) return <PageLoader />

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Reports</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Portfolio summary — generated {formatDate(data?.generated_at)}</p>
        </div>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 px-4 py-2 border border-border rounded-md text-sm text-muted-foreground hover:bg-accent transition-colors"
        >
          <Download size={15} /> Print / Export
        </button>
      </div>

      {/* Portfolio KPIs */}
      {data?.kpis && (
        <div className="bg-card rounded-lg p-6 space-y-4">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <FileText size={16} /> Portfolio Summary
          </h2>
          <div className="grid grid-cols-3 gap-6 text-sm">
            {[
              ['Total Portfolio Value', formatCurrency(data.kpis.total_portfolio_value)],
              ['Total Equity', formatCurrency(data.kpis.total_equity)],
              ['Total Debt', formatCurrency(data.kpis.total_debt)],
              ['LTV Ratio', formatPercent(data.kpis.ltv_ratio)],
              ['Monthly Gross Income', formatCurrency(data.kpis.monthly_gross_income)],
              ['Monthly Expenses', formatCurrency(data.kpis.monthly_expenses)],
              ['Monthly Net Cashflow', formatCurrency(data.kpis.monthly_net_cashflow)],
              ['Gross Yield', formatPercent(data.kpis.annual_gross_yield)],
              ['Properties', data.kpis.properties_count],
              ['Active Tenants', data.kpis.tenants_active],
              ['Occupancy Rate', formatPercent(data.kpis.occupancy_rate)],
            ].map(([k, v]) => (
              <div key={k as string}>
                <div className="text-xs text-muted-foreground">{k}</div>
                <div className="font-semibold text-foreground mt-0.5">{v}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Property-by-property */}
      {data?.properties && (
        <div className="bg-card rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-border">
            <h2 className="text-base font-semibold">Property Details</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground bg-muted/30 border-b border-border">
                <th className="text-left px-4 py-3">Property</th>
                <th className="text-left px-4 py-3">Type</th>
                <th className="text-right px-4 py-3">Value</th>
                <th className="text-right px-4 py-3">Mortgage</th>
                <th className="text-right px-4 py-3">Rent/mo</th>
                <th className="text-right px-4 py-3">Yield</th>
                <th className="text-left px-4 py-3">Tenant</th>
                <th className="text-right px-4 py-3">Rate</th>
                <th className="text-right px-4 py-3">Renewal</th>
              </tr>
            </thead>
            <tbody>
              {data.properties.map((p: any) => {
                const value = p.current_value ?? p.purchase_price ?? 0
                const yield_ = value > 0 && p.rent_amount ? ((p.rent_amount * 12 / value) * 100) : 0
                return (
                  <tr key={p.id} className="border-b border-border/40 hover:bg-muted/20">
                    <td className="px-4 py-3">
                      <div className="font-medium">{p.address_line1}</div>
                      <div className="text-xs text-muted-foreground">{p.town} {p.postcode}</div>
                    </td>
                    <td className="px-4 py-3 capitalize">{p.property_type} {p.bedrooms}bd</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(value, true)}</td>
                    <td className="px-4 py-3 text-right">{p.current_balance ? formatCurrency(p.current_balance, true) : '—'}</td>
                    <td className="px-4 py-3 text-right">{p.rent_amount ? formatCurrency(p.rent_amount) : '—'}</td>
                    <td className="px-4 py-3 text-right text-green-400">{yield_ > 0 ? formatPercent(yield_) : '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground">{p.tenant_name ?? 'Vacant'}</td>
                    <td className="px-4 py-3 text-right">{p.interest_rate ? `${p.interest_rate}%` : '—'}</td>
                    <td className="px-4 py-3 text-right">{p.renewal_date ? formatDate(p.renewal_date) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
