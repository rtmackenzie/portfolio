import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { X } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import { propertyKeys } from '@/hooks/useProperties'
import type { Tenant } from '@/types'

const schema = z.object({
  name: z.string().min(1, 'Required'),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  rent_amount: z.coerce.number().positive('Required'),
  rent_due_day: z.coerce.number().int().min(1).max(31),
  tenancy_start: z.string().min(1, 'Required'),
  tenancy_end: z.string().optional(),
  deposit_amount: z.coerce.number().optional().or(z.literal('')),
  deposit_scheme: z.string().optional(),
  status: z.enum(['active', 'ended', 'notice_given']),
  notes: z.string().optional(),
})

type FormData = z.infer<typeof schema>

interface Props {
  propertyId: number
  tenant?: Tenant
  onClose: () => void
}

const inputCls = 'w-full px-3 py-2 rounded-md bg-input border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary'
const labelCls = 'block text-xs font-medium text-muted-foreground mb-1'

export function TenantForm({ propertyId, tenant, onClose }: Props) {
  const qc = useQueryClient()

  const mutation = useMutation({
    mutationFn: (data: Partial<Tenant>) => tenant
      ? api.put<Tenant>(`/tenants/${tenant.id}`, data)
      : api.post<Tenant>('/tenants', { ...data, property_id: propertyId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: propertyKeys.detail(propertyId) })
      qc.invalidateQueries({ queryKey: propertyKeys.lists() })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      onClose()
    },
  })

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema) as any,
    defaultValues: tenant ? {
      name: tenant.name, email: tenant.email ?? '', phone: tenant.phone ?? '',
      rent_amount: tenant.rent_amount, rent_due_day: tenant.rent_due_day,
      tenancy_start: tenant.tenancy_start, tenancy_end: tenant.tenancy_end ?? '',
      deposit_amount: tenant.deposit_amount, deposit_scheme: tenant.deposit_scheme ?? '',
      status: tenant.status, notes: tenant.notes ?? '',
    } : { rent_due_day: 1, status: 'active' },
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">{tenant ? 'Edit Tenant' : 'Add Tenant'}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit(d => mutation.mutateAsync(d as any))} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className={labelCls}>Full Name *</label>
              <input {...register('name')} className={inputCls} placeholder="Sarah Johnson" />
              {errors.name && <p className="text-xs text-red-400 mt-1">{errors.name.message}</p>}
            </div>
            <div>
              <label className={labelCls}>Email</label>
              <input {...register('email')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Phone</label>
              <input {...register('phone')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Monthly Rent (£) *</label>
              <input type="number" {...register('rent_amount')} className={inputCls} />
              {errors.rent_amount && <p className="text-xs text-red-400 mt-1">{errors.rent_amount.message}</p>}
            </div>
            <div>
              <label className={labelCls}>Rent Due Day</label>
              <input type="number" {...register('rent_due_day')} className={inputCls} min={1} max={31} />
            </div>
            <div>
              <label className={labelCls}>Tenancy Start *</label>
              <input type="date" {...register('tenancy_start')} className={inputCls} />
              {errors.tenancy_start && <p className="text-xs text-red-400 mt-1">{errors.tenancy_start.message}</p>}
            </div>
            <div>
              <label className={labelCls}>Tenancy End</label>
              <input type="date" {...register('tenancy_end')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Deposit (£)</label>
              <input type="number" {...register('deposit_amount')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Deposit Scheme</label>
              <input {...register('deposit_scheme')} className={inputCls} placeholder="DPS, MyDeposits, TDS" />
            </div>
            <div>
              <label className={labelCls}>Status</label>
              <select {...register('status')} className={inputCls}>
                <option value="active">Active</option>
                <option value="notice_given">Notice Given</option>
                <option value="ended">Ended</option>
              </select>
            </div>
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
