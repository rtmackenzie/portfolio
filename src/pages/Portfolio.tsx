import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Building2, MapPin, Users, TrendingUp } from 'lucide-react'
import { useProperties, useCreateProperty, useDeleteProperty } from '@/hooks/useProperties'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { EmptyState } from '@/components/shared/EmptyState'
import { PageLoader } from '@/components/shared/LoadingSpinner'
import { PropertyForm } from '@/components/forms/PropertyForm'
import { formatCurrency, formatPercent } from '@/utils/currency'
import type { Property } from '@/types'

export default function Portfolio() {
  const navigate = useNavigate()
  const { data: properties, isLoading } = useProperties()
  const deleteProperty = useDeleteProperty()
  const [showAddForm, setShowAddForm] = useState(false)

  if (isLoading) return <PageLoader />

  const stats = {
    total: properties?.length ?? 0,
    let: properties?.filter(p => p.status === 'let').length ?? 0,
    vacant: properties?.filter(p => p.status === 'vacant').length ?? 0,
    totalValue: properties?.reduce((s, p) => s + (p.current_value ?? p.purchase_price ?? 0), 0) ?? 0,
    monthlyIncome: properties?.reduce((s, p) => s + (p.monthly_rent ?? 0), 0) ?? 0,
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Portfolio</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage your properties</p>
        </div>
        <button
          onClick={() => setShowAddForm(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
        >
          <Plus size={16} />
          Add Property
        </button>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-5 gap-3">
        {[
          { label: 'Total Properties', value: stats.total },
          { label: 'Let', value: stats.let },
          { label: 'Vacant', value: stats.vacant },
          { label: 'Portfolio Value', value: formatCurrency(stats.totalValue, true) },
          { label: 'Monthly Income', value: formatCurrency(stats.monthlyIncome) },
        ].map(s => (
          <div key={s.label} className="bg-card rounded-lg px-4 py-3 text-center">
            <div className="text-xl font-bold text-foreground">{s.value}</div>
            <div className="text-xs text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Property grid */}
      {!properties || properties.length === 0 ? (
        <EmptyState
          icon={<Building2 size={48} />}
          title="No properties yet"
          description="Add your first property to get started"
          action={
            <button onClick={() => setShowAddForm(true)} className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium">
              Add Property
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {properties.map(property => (
            <PropertyCard
              key={property.id}
              property={property}
              onClick={() => navigate(`/portfolio/${property.id}`)}
              onDelete={() => deleteProperty.mutate(property.id)}
            />
          ))}
        </div>
      )}

      {showAddForm && (
        <PropertyForm onClose={() => setShowAddForm(false)} />
      )}
    </div>
  )
}

function PropertyCard({ property, onClick, onDelete }: { property: Property; onClick: () => void; onDelete: () => void }) {
  const value = property.current_value ?? property.purchase_price ?? 0
  const equity = value - (property.mortgage_balance ?? 0)

  return (
    <div
      onClick={onClick}
      className="bg-card rounded-lg p-5 cursor-pointer hover:ring-1 hover:ring-primary/50 transition-all shadow-sm"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
            <MapPin size={11} />
            {property.postcode}
          </div>
          <h3 className="font-semibold text-foreground text-sm leading-snug truncate">{property.address_line1}</h3>
          <p className="text-xs text-muted-foreground">{property.town}</p>
        </div>
        <StatusBadge status={property.status} className="ml-2 flex-shrink-0" />
      </div>

      <div className="grid grid-cols-3 gap-3 mb-3">
        <div>
          <div className="text-xs text-muted-foreground">Value</div>
          <div className="text-sm font-semibold text-foreground">{formatCurrency(value, true)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Equity</div>
          <div className="text-sm font-semibold text-foreground">{formatCurrency(equity, true)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Yield</div>
          <div className="text-sm font-semibold text-foreground">
            {property.gross_yield ? formatPercent(property.gross_yield) : '—'}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between pt-3 border-t border-border">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Users size={12} />
          {property.tenant_name ?? 'Vacant'}
          {property.monthly_rent && <span className="text-foreground font-medium ml-1">{formatCurrency(property.monthly_rent)}/mo</span>}
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Building2 size={12} />
          {property.bedrooms}bd · {property.property_type}
        </div>
      </div>
    </div>
  )
}
