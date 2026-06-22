import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { X } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import { propertyKeys } from '@/hooks/useProperties'
import { today } from '@/utils/dates'
import type { MaintenanceRecord } from '@/types'

const schema = z.object({
  title: z.string().min(1, 'Required'),
  description: z.string().optional(),
  category: z.enum(['plumbing','electrical','roofing','heating','appliance','structural','cosmetic','garden','other']),
  cost: z.coerce.number().min(0),
  date: z.string().min(1, 'Required'),
  contractor: z.string().optional(),
  contractor_phone: z.string().optional(),
  status: z.enum(['pending','in_progress','completed','cancelled']),
  notes: z.string().optional(),
})

type FormData = z.infer<typeof schema>
const inputCls = 'w-full px-3 py-2 rounded-md bg-input border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary'
const labelCls = 'block text-xs font-medium text-muted-foreground mb-1'

export function MaintenanceForm({ propertyId, record, onClose }: { propertyId: number; record?: MaintenanceRecord; onClose: () => void }) {
  const qc = useQueryClient()
  const mutation = useMutation({
    mutationFn: (data: Partial<MaintenanceRecord>) => record
      ? api.put<MaintenanceRecord>(`/maintenance/${record.id}`, data)
      : api.post<MaintenanceRecord>('/maintenance', { ...data, property_id: propertyId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: propertyKeys.detail(propertyId) }); onClose() },
  })

  const { register, handleSubmit, formState: { isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema) as any,
    defaultValues: record ? {
      title: record.title, description: record.description ?? '', category: record.category,
      cost: record.cost, date: record.date, contractor: record.contractor ?? '',
      contractor_phone: record.contractor_phone ?? '', status: record.status, notes: record.notes ?? '',
    } : { category: 'other', cost: 0, date: today(), status: 'pending' },
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold">{record ? 'Edit Record' : 'Log Maintenance'}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit(d => mutation.mutateAsync(d as any))} className="p-6 space-y-4">
          <div>
            <label className={labelCls}>Title *</label>
            <input {...register('title')} className={inputCls} placeholder="Boiler service, Roof repair..." />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Category</label>
              <select {...register('category')} className={inputCls}>
                {['plumbing','electrical','roofing','heating','appliance','structural','cosmetic','garden','other'].map(c => (
                  <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Status</label>
              <select {...register('status')} className={inputCls}>
                <option value="pending">Pending</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Date *</label>
              <input type="date" {...register('date')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Cost (£)</label>
              <input type="number" step="0.01" {...register('cost')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Contractor</label>
              <input {...register('contractor')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Contractor Phone</label>
              <input {...register('contractor_phone')} className={inputCls} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Description</label>
            <textarea {...register('description')} className={inputCls} rows={2} />
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
