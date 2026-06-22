import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { X } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import { propertyKeys } from '@/hooks/useProperties'
import type { Mortgage } from '@/types'

const schema = z.object({
  lender: z.string().min(1, 'Required'),
  account_number: z.string().optional(),
  original_amount: z.coerce.number().positive('Required'),
  current_balance: z.coerce.number().min(0, 'Required'),
  interest_rate: z.coerce.number().positive('Required'),
  monthly_payment: z.coerce.number().positive('Required'),
  type: z.enum(['repayment', 'interest_only', 'tracker', 'fixed']),
  fixed_period_end: z.string().optional(),
  renewal_date: z.string().optional(),
  start_date: z.string().optional(),
  is_active: z.coerce.number(),
  notes: z.string().optional(),
})

type FormData = z.infer<typeof schema>

const inputCls = 'w-full px-3 py-2 rounded-md bg-input border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary'
const labelCls = 'block text-xs font-medium text-muted-foreground mb-1'

export function MortgageForm({ propertyId, mortgage, onClose }: { propertyId: number; mortgage?: Mortgage; onClose: () => void }) {
  const qc = useQueryClient()
  const mutation = useMutation({
    mutationFn: (data: Partial<Mortgage>) => mortgage
      ? api.put<Mortgage>(`/mortgages/${mortgage.id}`, data)
      : api.post<Mortgage>('/mortgages', { ...data, property_id: propertyId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: propertyKeys.detail(propertyId) })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      onClose()
    },
  })

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema) as any,
    defaultValues: mortgage ? {
      lender: mortgage.lender, account_number: mortgage.account_number ?? '',
      original_amount: mortgage.original_amount, current_balance: mortgage.current_balance,
      interest_rate: mortgage.interest_rate, monthly_payment: mortgage.monthly_payment,
      type: mortgage.type, fixed_period_end: mortgage.fixed_period_end ?? '',
      renewal_date: mortgage.renewal_date ?? '', start_date: mortgage.start_date ?? '',
      is_active: mortgage.is_active, notes: mortgage.notes ?? '',
    } : { type: 'fixed', is_active: 1 },
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold">{mortgage ? 'Edit Mortgage' : 'Add Mortgage'}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit(d => mutation.mutateAsync(d as any))} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className={labelCls}>Lender *</label>
              <input {...register('lender')} className={inputCls} placeholder="Nationwide, Halifax..." />
              {errors.lender && <p className="text-xs text-red-400 mt-1">{errors.lender.message}</p>}
            </div>
            <div>
              <label className={labelCls}>Account Number</label>
              <input {...register('account_number')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Type</label>
              <select {...register('type')} className={inputCls}>
                <option value="fixed">Fixed</option>
                <option value="tracker">Tracker</option>
                <option value="repayment">Repayment</option>
                <option value="interest_only">Interest Only</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Original Amount (£) *</label>
              <input type="number" {...register('original_amount')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Current Balance (£) *</label>
              <input type="number" {...register('current_balance')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Interest Rate (%) *</label>
              <input type="number" step="0.01" {...register('interest_rate')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Monthly Payment (£) *</label>
              <input type="number" step="0.01" {...register('monthly_payment')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Start Date</label>
              <input type="date" {...register('start_date')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Fixed Period End</label>
              <input type="date" {...register('fixed_period_end')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Renewal Date</label>
              <input type="date" {...register('renewal_date')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Active</label>
              <select {...register('is_active')} className={inputCls}>
                <option value={1}>Active</option>
                <option value={0}>Inactive</option>
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
