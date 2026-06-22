import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { X } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import { propertyKeys } from '@/hooks/useProperties'
import type { Certificate } from '@/types'

const schema = z.object({
  type: z.enum(['gas_safety','epc','electrical','pat','fire_risk','legionella','eicr','hmo_licence','planning','other']),
  issue_date: z.string().optional(),
  expiry_date: z.string().min(1, 'Required'),
  issuer: z.string().optional(),
  notes: z.string().optional(),
})

type FormData = z.infer<typeof schema>
const inputCls = 'w-full px-3 py-2 rounded-md bg-input border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary'
const labelCls = 'block text-xs font-medium text-muted-foreground mb-1'

const CERT_TYPES = [
  { value: 'gas_safety', label: 'Gas Safety' },
  { value: 'epc', label: 'EPC' },
  { value: 'electrical', label: 'Electrical' },
  { value: 'eicr', label: 'EICR' },
  { value: 'pat', label: 'PAT' },
  { value: 'fire_risk', label: 'Fire Risk' },
  { value: 'legionella', label: 'Legionella' },
  { value: 'hmo_licence', label: 'HMO Licence' },
  { value: 'planning', label: 'Planning' },
  { value: 'other', label: 'Other' },
]

export function CertificateForm({ propertyId, cert, onClose }: { propertyId: number; cert?: Certificate; onClose: () => void }) {
  const qc = useQueryClient()
  const mutation = useMutation({
    mutationFn: (data: Partial<Certificate>) => cert
      ? api.put<Certificate>(`/certificates/${cert.id}`, data)
      : api.post<Certificate>('/certificates', { ...data, property_id: propertyId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: propertyKeys.detail(propertyId) })
      qc.invalidateQueries({ queryKey: ['certificates'] })
      onClose()
    },
  })

  const { register, handleSubmit, formState: { isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema) as any,
    defaultValues: cert ? {
      type: cert.type, issue_date: cert.issue_date ?? '', expiry_date: cert.expiry_date,
      issuer: cert.issuer ?? '', notes: cert.notes ?? '',
    } : { type: 'gas_safety' },
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold">{cert ? 'Edit Certificate' : 'Add Certificate'}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit(d => mutation.mutateAsync(d as any))} className="p-6 space-y-4">
          <div>
            <label className={labelCls}>Certificate Type *</label>
            <select {...register('type')} className={inputCls}>
              {CERT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Issue Date</label>
              <input type="date" {...register('issue_date')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Expiry Date *</label>
              <input type="date" {...register('expiry_date')} className={inputCls} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Issuer / Company</label>
            <input {...register('issuer')} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Notes</label>
            <textarea {...register('notes')} className={inputCls} rows={2} />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-border rounded-md text-sm text-muted-foreground hover:bg-accent">Cancel</button>
            <button type="submit" disabled={isSubmitting} className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50">
              {isSubmitting ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
