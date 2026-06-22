import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, ShieldAlert, Pencil, Trash2 } from 'lucide-react'
import { api } from '@/services/api'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { PageLoader } from '@/components/shared/LoadingSpinner'
import { CertificateForm } from '@/components/forms/CertificateForm'
import { useProperties } from '@/hooks/useProperties'
import { formatDate, daysUntil } from '@/utils/dates'
import type { Certificate } from '@/types'

interface CertificatesData {
  expired: Certificate[]
  due_soon: Certificate[]
  valid: Certificate[]
  all: Certificate[]
}

export default function Calendar() {
  const { data, isLoading } = useQuery({
    queryKey: ['certificates', 'upcoming'],
    queryFn: () => api.get<CertificatesData>('/certificates/upcoming'),
  })
  const { data: properties } = useProperties()
  const [filter, setFilter] = useState<'all' | 'expired' | 'due_soon' | 'valid'>('all')
  const [propertyFilter, setPropertyFilter] = useState<string>('')
  const [showAddCert, setShowAddCert] = useState(false)
  const [editCert, setEditCert] = useState<Certificate | null>(null)
  const [selectedPropertyId, setSelectedPropertyId] = useState<number>(0)
  const qc = useQueryClient()
  const deleteCert = useMutation({
    mutationFn: (id: number) => api.delete(`/certificates/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['certificates'] }),
  })

  if (isLoading) return <PageLoader />

  const filtered = (data?.all ?? []).filter(c => {
    if (filter !== 'all' && c.computed_status !== filter) return false
    if (propertyFilter && String(c.property_id) !== propertyFilter) return false
    return true
  })

  const tabs = [
    { key: 'all', label: 'All', count: data?.all.length ?? 0 },
    { key: 'expired', label: 'Expired', count: data?.expired.length ?? 0, color: 'text-red-400' },
    { key: 'due_soon', label: 'Due Soon', count: data?.due_soon.length ?? 0, color: 'text-amber-400' },
    { key: 'valid', label: 'Valid', count: data?.valid.length ?? 0, color: 'text-green-400' },
  ] as const

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Compliance Calendar</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Track certificate expiry and compliance deadlines</p>
        </div>
      </div>

      {/* Summary pills */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Expired', count: data?.expired.length ?? 0, color: 'border-red-500/40 text-red-400', bg: 'bg-red-500/10' },
          { label: 'Due within 30 days', count: (data?.due_soon ?? []).filter(c => daysUntil(c.expiry_date) <= 30).length, color: 'border-amber-500/40 text-amber-400', bg: 'bg-amber-500/10' },
          { label: 'Due 30–90 days', count: (data?.due_soon ?? []).filter(c => daysUntil(c.expiry_date) > 30).length, color: 'border-yellow-500/40 text-yellow-400', bg: 'bg-yellow-500/10' },
          { label: 'Valid', count: data?.valid.length ?? 0, color: 'border-green-500/40 text-green-400', bg: 'bg-green-500/10' },
        ].map(s => (
          <div key={s.label} className={`rounded-lg px-4 py-3 border ${s.color} ${s.bg}`}>
            <div className={`text-2xl font-bold ${s.color.split(' ')[1]}`}>{s.count}</div>
            <div className="text-xs text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex gap-1 border-b border-border">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${filter === t.key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            >
              {t.label} <span className="ml-1 text-xs opacity-60">{t.count}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <select
            value={propertyFilter}
            onChange={e => setPropertyFilter(e.target.value)}
            className="px-3 py-1.5 rounded-md bg-input border border-border text-sm text-foreground focus:outline-none"
          >
            <option value="">All properties</option>
            {properties?.map(p => <option key={p.id} value={p.id}>{p.address_line1}</option>)}
          </select>
          <button
            onClick={() => { setSelectedPropertyId(properties?.[0]?.id ?? 0); setShowAddCert(true) }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-xs font-medium"
          >
            <Plus size={13} /> Add Certificate
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-card rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground border-b border-border bg-muted/30">
              <th className="text-left px-4 py-3">Property</th>
              <th className="text-left px-4 py-3">Certificate</th>
              <th className="text-right px-4 py-3">Issue Date</th>
              <th className="text-right px-4 py-3">Expiry Date</th>
              <th className="text-right px-4 py-3">Days Remaining</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                <ShieldAlert size={32} className="mx-auto mb-2 opacity-40" />
                No certificates match this filter
              </td></tr>
            ) : filtered.map(c => {
              const days = daysUntil(c.expiry_date)
              const daysColor = days < 0 ? 'text-red-400' : days <= 30 ? 'text-amber-400' : days <= 90 ? 'text-yellow-400' : 'text-green-400'
              return (
                <tr key={c.id} className="border-b border-border/50 hover:bg-muted/20">
                  <td className="px-4 py-3">
                    <div className="text-foreground">{c.address_line1}</div>
                    <div className="text-xs text-muted-foreground">{c.town}</div>
                  </td>
                  <td className="px-4 py-3 capitalize">{c.type.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-3 text-right text-muted-foreground">{c.issue_date ? formatDate(c.issue_date) : '—'}</td>
                  <td className="px-4 py-3 text-right">{formatDate(c.expiry_date)}</td>
                  <td className={`px-4 py-3 text-right font-medium ${daysColor}`}>
                    {days < 0 ? `${Math.abs(days)}d ago` : `${days}d`}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={c.computed_status ?? c.status} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setEditCert(c)} className="text-muted-foreground hover:text-foreground"><Pencil size={13} /></button>
                      <button onClick={() => { if (confirm('Delete this certificate?')) deleteCert.mutate(c.id) }} className="text-muted-foreground hover:text-red-400"><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {showAddCert && selectedPropertyId > 0 && (
        <CertificateForm propertyId={selectedPropertyId} onClose={() => setShowAddCert(false)} />
      )}
      {editCert && (
        <CertificateForm propertyId={editCert.property_id} cert={editCert} onClose={() => setEditCert(null)} />
      )}
    </div>
  )
}
