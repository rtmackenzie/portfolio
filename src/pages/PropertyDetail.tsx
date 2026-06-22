import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Edit, Pencil, Plus, Trash2, Building2 } from 'lucide-react'
import { useProperty, useDeleteProperty, useUpdateProperty } from '@/hooks/useProperties'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import { propertyKeys } from '@/hooks/useProperties'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { KPICard } from '@/components/shared/KPICard'
import { EmptyState } from '@/components/shared/EmptyState'
import { PageLoader } from '@/components/shared/LoadingSpinner'
import { PropertyForm } from '@/components/forms/PropertyForm'
import { TenantForm } from '@/components/forms/TenantForm'
import { MortgageForm } from '@/components/forms/MortgageForm'
import { MaintenanceForm } from '@/components/forms/MaintenanceForm'
import { CertificateForm } from '@/components/forms/CertificateForm'
import { ExpenseForm } from '@/components/forms/ExpenseForm'
import { ValuationForm } from '@/components/forms/ValuationForm'
import { formatCurrency, formatPercent } from '@/utils/currency'
import { formatDate, daysUntil } from '@/utils/dates'
import type { Tenant, Mortgage, Expense, PropertyValuation, MaintenanceRecord, Certificate } from '@/types'

const TABS = ['Overview', 'Tenants', 'Mortgage', 'Expenses', 'Valuations', 'Maintenance', 'Certificates', 'Documents'] as const
type Tab = typeof TABS[number]

export default function PropertyDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const propertyId = Number(id)
  const qc = useQueryClient()

  const { data, isLoading } = useProperty(propertyId)
  const deleteProperty = useDeleteProperty()
  const [activeTab, setActiveTab] = useState<Tab>('Overview')
  const [showEditProperty, setShowEditProperty] = useState(false)
  const [showAddTenant, setShowAddTenant] = useState(false)
  const [showAddMortgage, setShowAddMortgage] = useState(false)
  const [showAddMaintenance, setShowAddMaintenance] = useState(false)
  const [showAddCert, setShowAddCert] = useState(false)
  const [editTenant, setEditTenant] = useState<Tenant | null>(null)
  const [editMortgage, setEditMortgage] = useState<Mortgage | null>(null)
  const [showAddExpense, setShowAddExpense] = useState(false)
  const [editExpense, setEditExpense] = useState<Expense | null>(null)
  const [showAddValuation, setShowAddValuation] = useState(false)
  const [editValuation, setEditValuation] = useState<PropertyValuation | null>(null)
  const [editMaintenance, setEditMaintenance] = useState<MaintenanceRecord | null>(null)
  const [editCert, setEditCert] = useState<Certificate | null>(null)

  const deleteExpense = useMutation({
    mutationFn: (eid: number) => api.delete(`/finances/expenses/${eid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: propertyKeys.detail(propertyId) }),
  })
  const deleteMortgage = useMutation({
    mutationFn: (mid: number) => api.delete(`/mortgages/${mid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: propertyKeys.detail(propertyId) }),
  })
  const deleteMaintenance = useMutation({
    mutationFn: (mid: number) => api.delete(`/maintenance/${mid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: propertyKeys.detail(propertyId) }),
  })
  const deleteCert = useMutation({
    mutationFn: (cid: number) => api.delete(`/certificates/${cid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: propertyKeys.detail(propertyId) }),
  })

  if (isLoading) return <PageLoader />
  if (!data) return <div className="text-muted-foreground p-8">Property not found</div>

  const { property, financials, tenants, mortgages, expenses, valuations, maintenance, certificates, documents } = data
  const activeTenant = tenants.find(t => t.status === 'active')
  const activeMortgage = mortgages.find(m => m.is_active === 1)

  async function handleDelete() {
    if (!confirm('Delete this property? This cannot be undone.')) return
    await deleteProperty.mutateAsync(propertyId)
    navigate('/portfolio')
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4">
          <button onClick={() => navigate('/portfolio')} className="mt-1 text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft size={20} />
          </button>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-2xl font-bold text-foreground">{property.address_line1}</h1>
              <StatusBadge status={property.status} />
            </div>
            <p className="text-sm text-muted-foreground">
              {[property.address_line2, property.town, property.county, property.postcode].filter(Boolean).join(', ')}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5 capitalize">
              {property.property_type} · {property.bedrooms} bed · {property.bathrooms} bath
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowEditProperty(true)} className="flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-md text-xs text-muted-foreground hover:bg-accent transition-colors">
            <Edit size={13} /> Edit
          </button>
          <button onClick={handleDelete} className="flex items-center gap-1.5 px-3 py-1.5 border border-red-500/40 rounded-md text-xs text-red-400 hover:bg-red-500/10 transition-colors">
            <Trash2 size={13} /> Delete
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-6 gap-3">
        <KPICard label="Value" value={formatCurrency(property.current_value ?? property.purchase_price ?? 0, true)} />
        <KPICard label="Equity" value={formatCurrency(financials.equity, true)} variant={financials.equity > 0 ? 'success' : 'danger'} />
        <KPICard label="LTV" value={formatPercent(financials.ltv)} variant={financials.ltv > 75 ? 'warning' : 'default'} />
        <KPICard label="Net Cashflow" value={formatCurrency(financials.monthly_net_cashflow) + '/mo'} variant={financials.monthly_net_cashflow >= 0 ? 'success' : 'danger'} />
        <KPICard label="Gross Yield" value={formatPercent(financials.gross_yield)} />
        <KPICard label="Annual ROI" value={formatPercent(financials.annual_roi)} />
      </div>

      {/* Tabs */}
      <div className="border-b border-border">
        <nav className="flex gap-0">
          {TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      {activeTab === 'Overview' && (
        <div className="grid grid-cols-2 gap-6">
          <div className="bg-card rounded-lg p-5 space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Property Details</h3>
            <dl className="space-y-2">
              {[
                ['Purchase Date', formatDate(property.purchase_date)],
                ['Purchase Price', property.purchase_price ? formatCurrency(property.purchase_price) : '—'],
                ['Current Value', property.current_value ? formatCurrency(property.current_value) : '—'],
                ['Capital Growth', property.purchase_price && property.current_value
                  ? formatCurrency(property.current_value - property.purchase_price) : '—'],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between text-sm">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="text-foreground font-medium">{v}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="bg-card rounded-lg p-5 space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Monthly Financials</h3>
            <dl className="space-y-2">
              {[
                ['Gross Income', formatCurrency(financials.monthly_gross_income)],
                ['Mortgage', `−${formatCurrency(financials.monthly_mortgage)}`],
                ['Other Expenses', `−${formatCurrency(financials.monthly_other_expenses)}`],
                ['Net Cashflow', formatCurrency(financials.monthly_net_cashflow)],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between text-sm">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className={`font-medium ${k === 'Net Cashflow' ? (financials.monthly_net_cashflow >= 0 ? 'text-green-400' : 'text-red-400') : 'text-foreground'}`}>{v}</dd>
                </div>
              ))}
            </dl>
          </div>

          {activeTenant && (
            <div className="bg-card rounded-lg p-5 space-y-3">
              <h3 className="text-sm font-semibold text-foreground">Current Tenant</h3>
              <dl className="space-y-2">
                {[
                  ['Name', activeTenant.name],
                  ['Rent', `${formatCurrency(activeTenant.rent_amount)}/mo`],
                  ['Due Day', `${activeTenant.rent_due_day}${ordinal(activeTenant.rent_due_day)} of month`],
                  ['Start Date', formatDate(activeTenant.tenancy_start)],
                  ['End Date', activeTenant.tenancy_end ? formatDate(activeTenant.tenancy_end) : 'Ongoing'],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between text-sm">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="text-foreground font-medium">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {activeMortgage && (
            <div className="bg-card rounded-lg p-5 space-y-3">
              <h3 className="text-sm font-semibold text-foreground">Active Mortgage</h3>
              <dl className="space-y-2">
                {[
                  ['Lender', activeMortgage.lender],
                  ['Balance', formatCurrency(activeMortgage.current_balance)],
                  ['Rate', `${activeMortgage.interest_rate}%`],
                  ['Monthly', formatCurrency(activeMortgage.monthly_payment)],
                  ['Renewal', activeMortgage.renewal_date ? formatDate(activeMortgage.renewal_date) : '—'],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between text-sm">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="text-foreground font-medium">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {property.notes && (
            <div className="col-span-2 bg-card rounded-lg p-5">
              <h3 className="text-sm font-semibold text-foreground mb-2">Notes</h3>
              <p className="text-sm text-muted-foreground">{property.notes}</p>
            </div>
          )}
        </div>
      )}

      {activeTab === 'Expenses' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-semibold text-foreground">Recurring Expenses</h3>
            <button onClick={() => setShowAddExpense(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-xs font-medium">
              <Plus size={13} /> Add Expense
            </button>
          </div>
          <div className="bg-card rounded-lg overflow-hidden">
            {(expenses as Expense[]).length === 0 ? (
              <p className="text-sm text-muted-foreground p-5">No expenses recorded for this property.</p>
            ) : (
              <table className="w-full text-sm">
                <thead><tr className="text-xs text-muted-foreground border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-3">Category</th>
                  <th className="text-left px-4 py-3">Description</th>
                  <th className="text-right px-4 py-3">Amount</th>
                  <th className="text-right px-4 py-3">Frequency</th>
                  <th className="text-right px-4 py-3">/mo</th>
                  <th className="px-4 py-3"></th>
                </tr></thead>
                <tbody>
                  {(expenses as Expense[]).map(e => {
                    const monthly = e.frequency === 'monthly' ? e.amount : e.frequency === 'quarterly' ? e.amount / 3 : e.frequency === 'annually' ? e.amount / 12 : 0
                    return (
                      <tr key={e.id} className="border-b border-border/50 hover:bg-muted/20">
                        <td className="px-4 py-3 capitalize">{e.category.replace(/_/g, ' ')}</td>
                        <td className="px-4 py-3 text-muted-foreground">{e.description ?? '—'}</td>
                        <td className="px-4 py-3 text-right">{formatCurrency(e.amount)}</td>
                        <td className="px-4 py-3 text-right capitalize">{e.frequency}</td>
                        <td className="px-4 py-3 text-right font-medium">{formatCurrency(monthly)}</td>
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
            )}
          </div>
        </div>
      )}

      {activeTab === 'Valuations' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-semibold text-foreground">Valuation History</h3>
            <button onClick={() => setShowAddValuation(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-xs font-medium">
              <Plus size={13} /> Add Valuation
            </button>
          </div>
          <div className="bg-card rounded-lg overflow-hidden">
            {(valuations as PropertyValuation[]).length === 0 ? (
              <p className="text-sm text-muted-foreground p-5">No valuations recorded yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead><tr className="text-xs text-muted-foreground border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-3">Date</th>
                  <th className="text-left px-4 py-3">Source</th>
                  <th className="text-left px-4 py-3">Notes</th>
                  <th className="text-right px-4 py-3">Value</th>
                  <th className="px-4 py-3"></th>
                </tr></thead>
                <tbody>
                  {[...(valuations as PropertyValuation[])].sort((a, b) => b.valuation_date.localeCompare(a.valuation_date)).map(v => (
                    <tr key={v.id} className="border-b border-border/50 hover:bg-muted/20">
                      <td className="px-4 py-3">{formatDate(v.valuation_date)}</td>
                      <td className="px-4 py-3 capitalize text-muted-foreground">{v.source.replace(/_/g, ' ')}</td>
                      <td className="px-4 py-3 text-muted-foreground">{v.notes ?? '—'}</td>
                      <td className="px-4 py-3 text-right font-medium">{formatCurrency(v.amount)}</td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => setEditValuation(v)} className="text-muted-foreground hover:text-foreground"><Pencil size={13} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {activeTab === 'Tenants' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-semibold text-foreground">Tenancy History</h3>
            <button onClick={() => setShowAddTenant(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-xs font-medium">
              <Plus size={13} /> Add Tenant
            </button>
          </div>
          {tenants.length === 0 ? (
            <EmptyState icon={<Building2 size={36} />} title="No tenants" description="Add a tenant to this property" />
          ) : (
            <div className="space-y-3">
              {tenants.map(tenant => (
                <div key={tenant.id} className="bg-card rounded-lg p-4 flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-foreground">{tenant.name}</span>
                      <StatusBadge status={tenant.status} />
                    </div>
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      {tenant.email && <div>{tenant.email}</div>}
                      {tenant.phone && <div>{tenant.phone}</div>}
                      <div>{formatCurrency(tenant.rent_amount)}/mo · Due {tenant.rent_due_day}{ordinal(tenant.rent_due_day)}</div>
                      <div>{formatDate(tenant.tenancy_start)} → {tenant.tenancy_end ? formatDate(tenant.tenancy_end) : 'ongoing'}</div>
                    </div>
                  </div>
                  <button onClick={() => setEditTenant(tenant)} className="text-muted-foreground hover:text-foreground">
                    <Edit size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'Mortgage' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-semibold">Mortgages</h3>
            <button onClick={() => setShowAddMortgage(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-xs font-medium">
              <Plus size={13} /> Add Mortgage
            </button>
          </div>
          {mortgages.length === 0 ? (
            <EmptyState icon={<Building2 size={36} />} title="No mortgages recorded" />
          ) : (
            <div className="space-y-3">
              {mortgages.map(m => (
                <div key={m.id} className="bg-card rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{m.lender}</span>
                      <StatusBadge status={m.type} />
                      {m.is_active ? <span className="text-xs text-green-400">Active</span> : <span className="text-xs text-muted-foreground">Inactive</span>}
                    </div>
                    <div className="flex gap-1.5">
                      <button onClick={() => setEditMortgage(m as Mortgage)} className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent rounded">
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => deleteMortgage.mutate(m.id)} className="p-1.5 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 rounded">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    {[
                      ['Balance', formatCurrency(m.current_balance)],
                      ['Rate', `${m.interest_rate}%`],
                      ['Monthly', formatCurrency(m.monthly_payment)],
                      ['Original', formatCurrency(m.original_amount)],
                      ['Fixed End', m.fixed_period_end ? formatDate(m.fixed_period_end) : '—'],
                      ['Renewal', m.renewal_date ? formatDate(m.renewal_date) : '—'],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <div className="text-xs text-muted-foreground">{k}</div>
                        <div className="font-medium text-foreground">{v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'Maintenance' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-semibold">Maintenance Log</h3>
            <button onClick={() => setShowAddMaintenance(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-xs font-medium">
              <Plus size={13} /> Log Maintenance
            </button>
          </div>
          {maintenance.length === 0 ? (
            <EmptyState icon={<Building2 size={36} />} title="No maintenance records" />
          ) : (
            <div className="space-y-2">
              {(maintenance as MaintenanceRecord[]).map(m => (
                <div key={m.id} className="bg-card rounded-lg p-4 flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium">{m.title}</span>
                      <StatusBadge status={m.status} />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDate(m.date)} · {m.category} · {m.cost > 0 ? formatCurrency(m.cost) : 'No cost recorded'}
                      {m.contractor && ` · ${m.contractor}`}
                    </div>
                    {m.description && <p className="text-xs text-muted-foreground mt-1">{m.description}</p>}
                  </div>
                  <div className="flex gap-2 ml-4">
                    <button onClick={() => setEditMaintenance(m)} className="text-muted-foreground hover:text-foreground"><Edit size={13} /></button>
                    <button onClick={() => deleteMaintenance.mutate(m.id)} className="text-muted-foreground hover:text-red-400"><Trash2 size={13} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'Certificates' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-semibold">Compliance Certificates</h3>
            <button onClick={() => setShowAddCert(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-xs font-medium">
              <Plus size={13} /> Add Certificate
            </button>
          </div>
          {certificates.length === 0 ? (
            <EmptyState icon={<Building2 size={36} />} title="No certificates recorded" description="Add gas safety, EPC, electrical certs" />
          ) : (
            <div className="space-y-2">
              {(certificates as Certificate[]).map(c => {
                const days = daysUntil(c.expiry_date)
                const statusColor = days < 0 ? 'text-red-400' : days <= 60 ? 'text-amber-400' : 'text-green-400'
                return (
                  <div key={c.id} className="bg-card rounded-lg p-4 flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-medium capitalize">{c.type.replace(/_/g, ' ')}</span>
                        <StatusBadge status={c.computed_status ?? c.status} />
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Issued: {c.issue_date ? formatDate(c.issue_date) : '—'} · Expires: {formatDate(c.expiry_date)}
                        {c.issuer && ` · ${c.issuer}`}
                      </div>
                      <div className={`text-xs font-medium mt-0.5 ${statusColor}`}>
                        {days < 0 ? `Expired ${Math.abs(days)} days ago` : `${days} days remaining`}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setEditCert(c)} className="text-muted-foreground hover:text-foreground"><Edit size={13} /></button>
                      <button onClick={() => deleteCert.mutate(c.id)} className="text-muted-foreground hover:text-red-400"><Trash2 size={13} /></button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === 'Documents' && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold">Documents</h3>
          {documents.length === 0 ? (
            <EmptyState icon={<Building2 size={36} />} title="No documents" description="Document storage coming soon — add file paths to track your documents" />
          ) : (
            <div className="space-y-2">
              {documents.map((d: any) => (
                <div key={d.id} className="bg-card rounded-lg p-4">
                  <div className="text-sm font-medium">{d.name}</div>
                  <div className="text-xs text-muted-foreground capitalize">{d.type.replace(/_/g,' ')}{d.expiry_date && ` · Expires: ${formatDate(d.expiry_date)}`}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {showEditProperty && <PropertyForm property={property} onClose={() => setShowEditProperty(false)} />}
      {(showAddTenant || editTenant) && (
        <TenantForm propertyId={propertyId} tenant={editTenant ?? undefined} onClose={() => { setShowAddTenant(false); setEditTenant(null) }} />
      )}
      {(showAddMortgage || editMortgage) && (
        <MortgageForm propertyId={propertyId} mortgage={editMortgage ?? undefined} onClose={() => { setShowAddMortgage(false); setEditMortgage(null) }} />
      )}
      {(showAddExpense || editExpense) && (
        <ExpenseForm propertyId={propertyId} expense={editExpense ?? undefined} onClose={() => { setShowAddExpense(false); setEditExpense(null) }} />
      )}
      {(showAddValuation || editValuation) && (
        <ValuationForm propertyId={propertyId} valuation={editValuation ?? undefined} onClose={() => { setShowAddValuation(false); setEditValuation(null) }} />
      )}
      {(showAddMaintenance || editMaintenance) && (
        <MaintenanceForm propertyId={propertyId} record={editMaintenance ?? undefined} onClose={() => { setShowAddMaintenance(false); setEditMaintenance(null) }} />
      )}
      {(showAddCert || editCert) && (
        <CertificateForm propertyId={propertyId} cert={editCert ?? undefined} onClose={() => { setShowAddCert(false); setEditCert(null) }} />
      )}
    </div>
  )
}

function ordinal(n: number): string {
  if (n >= 11 && n <= 13) return 'th'
  switch (n % 10) {
    case 1: return 'st'
    case 2: return 'nd'
    case 3: return 'rd'
    default: return 'th'
  }
}
