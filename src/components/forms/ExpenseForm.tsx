import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { X } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useProperties } from '@/hooks/useProperties'
import { propertyKeys } from '@/hooks/useProperties'
import { api } from '@/services/api'
import type { Expense } from '@/types'

const CATEGORIES = [
  'mortgage', 'insurance', 'letting_agent', 'maintenance', 'utilities',
  'council_tax', 'ground_rent', 'service_charge', 'accountancy', 'legal', 'travel', 'other',
] as const

const schema = z.object({
  property_id: z.coerce.number().optional().or(z.literal('')),
  category: z.enum(CATEGORIES),
  amount: z.coerce.number().positive('Required'),
  frequency: z.enum(['monthly', 'quarterly', 'annually', 'once']),
  description: z.string().optional(),
  active: z.coerce.number(),
})

type FormData = z.infer<typeof schema>

const inputCls = 'w-full px-3 py-2 rounded-md bg-input border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary'
const labelCls = 'block text-xs font-medium text-muted-foreground mb-1'

interface Props {
  expense?: Expense
  propertyId?: number   // when set: pre-fills the property and hides the property selector
  onClose: () => void
}

export function ExpenseForm({ expense, propertyId, onClose }: Props) {
  const qc = useQueryClient()
  const { data: properties } = useProperties()

  const mutation = useMutation({
    mutationFn: (data: Partial<Expense>) =>
      expense
        ? api.put<Expense>(`/finances/expenses/${expense.id}`, data)
        : api.post<Expense>('/finances/expenses', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['finances'] })
      // Also refresh the property detail cache when editing from within a property
      if (propertyId) qc.invalidateQueries({ queryKey: propertyKeys.detail(propertyId) })
      onClose()
    },
  })

  const { register, handleSubmit, formState: { isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema) as any,
    defaultValues: expense
      ? {
          property_id: expense.property_id ?? '',
          category: expense.category as typeof CATEGORIES[number],
          amount: expense.amount,
          frequency: expense.frequency as 'monthly' | 'quarterly' | 'annually' | 'once',
          description: expense.description ?? '',
          active: expense.active,
        }
      : {
          property_id: propertyId ?? '',
          category: 'insurance',
          frequency: 'monthly',
          active: 1,
        },
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold">{expense ? 'Edit Expense' : 'Add Expense'}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit(d => mutation.mutateAsync(d as any))} className="space-y-4">
          {!propertyId && (
            <div>
              <label className={labelCls}>Property (optional)</label>
              <select {...register('property_id')} className={inputCls}>
                <option value="">Portfolio-wide</option>
                {properties?.map(p => (
                  <option key={p.id} value={p.id}>{p.address_line1}, {p.town}</option>
                ))}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Category *</label>
              <select {...register('category')} className={inputCls}>
                {CATEGORIES.map(c => (
                  <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Frequency</label>
              <select {...register('frequency')} className={inputCls}>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annually">Annually</option>
                <option value="once">One-off</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Amount (£) *</label>
              <input type="number" step="0.01" {...register('amount')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Description</label>
              <input {...register('description')} className={inputCls} placeholder="e.g. Landlord insurance" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="active" {...register('active')} defaultChecked={true} className="rounded" />
            <label htmlFor="active" className="text-sm text-muted-foreground">Active (included in calculations)</label>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-border rounded-md text-sm text-muted-foreground hover:bg-accent">Cancel</button>
            <button type="submit" disabled={isSubmitting} className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium disabled:opacity-50">
              {isSubmitting ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
