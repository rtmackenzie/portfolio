import { useState } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { useFinancialSummary, useExpenses, useDeleteExpense, useRentPayments, useUpdateRentPayment } from '@/hooks/useFinancials'
import { KPICard } from '@/components/shared/KPICard'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { PageLoader } from '@/components/shared/LoadingSpinner'
import { CashflowBarChart, ExpenseDonutChart } from '@/components/charts'
import { formatCurrency, formatPercent } from '@/utils/currency'
import { formatDate, today } from '@/utils/dates'
import { useProperties } from '@/hooks/useProperties'
import { ExpenseForm } from '@/components/forms/ExpenseForm'
import type { Expense } from '@/types'

export default function Financials() {
  const { data: summary, isLoading } = useFinancialSummary()
  const { data: expenses } = useExpenses()
  const { data: payments } = useRentPayments()
  const { data: properties } = useProperties()
  const deleteExpense = useDeleteExpense()
  const updatePayment = useUpdateRentPayment()
  const [showExpenseForm, setShowExpenseForm] = useState(false)
  const [editExpense, setEditExpense] = useState<Expense | null>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'expenses' | 'rentroll'>('overview')

  if (isLoading) return <PageLoader />

  const monthlyMortgage = summary?.ytd_monthly_mortgage ?? 0
  const monthsElapsed = new Date().getMonth() + 1
  const ytdNet = (summary?.ytd_income ?? 0)
    - ((summary?.ytd_expenses_monthly_rate ?? 0) * monthsElapsed)
    - (monthlyMortgage * monthsElapsed)

  const monthlyIncome = monthsElapsed > 0 ? (summary?.ytd_income ?? 0) / monthsElapsed : 0
  const projectedIncome = monthlyIncome * 12
  const projectedNet = projectedIncome
    - ((summary?.ytd_expenses_monthly_rate ?? 0) * 12)
    - (monthlyMortgage * 12)

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Financials</h1>

      <div className="grid grid-cols-5 gap-4">
        <KPICard label="YTD Income" value={formatCurrency(summary?.ytd_income ?? 0, true)} />
        <KPICard label="YTD Net" value={formatCurrency(ytdNet, true)} variant={ytdNet >= 0 ? 'success' : 'danger'} />
        <KPICard label="Monthly Expenses" value={formatCurrency(summary?.ytd_expenses_monthly_rate ?? 0)} subtext="Operating costs" />
        <KPICard label="Monthly Mortgage" value={formatCurrency(monthlyMortgage)} subtext="All active mortgages" />
        <KPICard label="Properties" value={properties?.length ?? 0} subtext={`${properties?.filter(p => p.status === 'let').length ?? 0} let`} />
      </div>

      <div className="grid grid-cols-5 gap-4">
        <KPICard label="Projected Year-End Income" value={formatCurrency(projectedIncome, true)} subtext="Based on current monthly rate" />
        <KPICard label="Projected Year-End Net" value={formatCurrency(projectedNet, true)} subtext="Income minus expenses & mortgage" variant={projectedNet >= 0 ? 'success' : 'danger'} />
      </div>

      <div className="flex gap-1 border-b border-border">
        {(['overview', 'expenses', 'rentroll'] as const).map(t => (
          <button key={t} onClick={() => setActiveTab(t)} className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors capitalize ${activeTab === t ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {t === 'rentroll' ? 'Rent Roll' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2 bg-card rounded-lg p-5">
            <h3 className="text-sm font-semibold mb-4">Monthly Income</h3>
            {summary?.monthly_chart && summary.monthly_chart.length > 0 ? (
              <CashflowBarChart data={summary.monthly_chart} />
            ) : (
              <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">No data yet</div>
            )}
          </div>
          <div className="bg-card rounded-lg p-5">
            <h3 className="text-sm font-semibold mb-4">Expenses by Category</h3>
            {summary?.expense_by_category && summary.expense_by_category.length > 0 ? (
              <ExpenseDonutChart data={summary.expense_by_category} />
            ) : (
              <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">No expenses</div>
            )}
          </div>
          <div className="col-span-3 bg-card rounded-lg p-5">
            <h3 className="text-sm font-semibold mb-4">Income by Property</h3>
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-muted-foreground border-b border-border">
                <th className="text-left pb-2">Property</th>
                <th className="text-right pb-2">Monthly Rent</th>
                <th className="text-right pb-2">Annual Rent</th>
                <th className="text-right pb-2">Value</th>
                <th className="text-right pb-2">Gross Yield</th>
              </tr></thead>
              <tbody>
                {summary?.income_by_property?.map(p => (
                  <tr key={p.property_id} className="border-b border-border/50">
                    <td className="py-2 text-foreground">{p.address}</td>
                    <td className="py-2 text-right">{formatCurrency(p.monthly_rent)}</td>
                    <td className="py-2 text-right">{formatCurrency(p.monthly_rent * 12)}</td>
                    <td className="py-2 text-right">{formatCurrency(p.current_value, true)}</td>
                    <td className="py-2 text-right text-green-400">{formatPercent(p.gross_yield)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'expenses' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-semibold">Recurring Expenses</h3>
            <button onClick={() => setShowExpenseForm(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-xs font-medium">
              <Plus size={13} /> Add Expense
            </button>
          </div>
          <div className="bg-card rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-muted-foreground border-b border-border bg-muted/30">
                <th className="text-left px-4 py-3">Property</th>
                <th className="text-left px-4 py-3">Category</th>
                <th className="text-left px-4 py-3">Description</th>
                <th className="text-right px-4 py-3">Amount</th>
                <th className="text-right px-4 py-3">Frequency</th>
                <th className="text-right px-4 py-3">Monthly</th>
                <th className="px-4 py-3"></th>
              </tr></thead>
              <tbody>
                {expenses?.map(e => {
                  const monthly = e.frequency === 'monthly' ? e.amount : e.frequency === 'quarterly' ? e.amount/3 : e.frequency === 'annually' ? e.amount/12 : 0
                  return (
                    <tr key={e.id} className="border-b border-border/50 hover:bg-muted/20">
                      <td className="px-4 py-3 text-muted-foreground text-xs">{e.property_address}</td>
                      <td className="px-4 py-3 capitalize">{e.category.replace(/_/g,' ')}</td>
                      <td className="px-4 py-3 text-muted-foreground">{e.description ?? '—'}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(e.amount)}</td>
                      <td className="px-4 py-3 text-right capitalize">{e.frequency}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground">{formatCurrency(monthly)}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <button onClick={() => setEditExpense(e)} className="text-muted-foreground hover:text-foreground"><Pencil size={13} /></button>
                          <button onClick={() => deleteExpense.mutate(e.id)} className="text-muted-foreground hover:text-red-400"><Trash2 size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'rentroll' && (
        <div className="bg-card rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-muted-foreground border-b border-border bg-muted/30">
              <th className="text-left px-4 py-3">Property</th>
              <th className="text-left px-4 py-3">Tenant</th>
              <th className="text-right px-4 py-3">Amount</th>
              <th className="text-right px-4 py-3">Due Date</th>
              <th className="text-right px-4 py-3">Paid Date</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr></thead>
            <tbody>
              {payments?.slice(0, 50).map(p => (
                <tr key={p.id} className="border-b border-border/50 hover:bg-muted/20">
                  <td className="px-4 py-3 text-xs text-muted-foreground">{p.address_line1}</td>
                  <td className="px-4 py-3">{p.tenant_name ?? '—'}</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(p.amount)}</td>
                  <td className="px-4 py-3 text-right">{formatDate(p.due_date)}</td>
                  <td className="px-4 py-3 text-right">{p.paid_date ? formatDate(p.paid_date) : '—'}</td>
                  <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                  <td className="px-4 py-3">
                    {p.status === 'pending' && (
                      <button
                        onClick={() => updatePayment.mutate({ id: p.id, data: { ...p, status: 'paid', paid_date: today() } })}
                        className="text-xs text-green-400 hover:text-green-300"
                      >
                        Mark Paid
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(showExpenseForm || editExpense) && (
        <ExpenseForm
          expense={editExpense ?? undefined}
          onClose={() => { setShowExpenseForm(false); setEditExpense(null) }}
        />
      )}
    </div>
  )
}
