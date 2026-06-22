import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { X } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import { propertyKeys } from '@/hooks/useProperties'
import { today } from '@/utils/dates'
import type { PropertyValuation } from '@/types'

const SOURCES = ['self', 'portal', 'estate_agent', 'mortgage_lender', 'surveyor'] as const

const schema = z.object({
  valuation_date: z.string().min(1, 'Required'),
  amount: z.coerce.number().positive('Required'),
  source: z.enum(SOURCES),
  notes: z.string().optional(),
})

type FormData = z.infer<typeof schema>

const inputCls = 'w-full px-3 py-2 rounded-md bg-input border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary'
const labelCls = 'block text-xs font-medium text-muted-foreground mb-1'

interface Props {
  propertyId: number
  valuation?: PropertyValuation
  onClose: () => void
}

export function ValuationForm({ propertyId, valuation, onClose }: Props) {
  const qc = useQueryClient()

  const mutation = useMutation({
    mutationFn: (data: FormData) =>
      valuation
        ? api.put(`/properties/${propertyId}/valuations/${valuation.id}`, data)
        : api.post(`/properties/${propertyId}/valuations`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: propertyKeys.detail(propertyId) })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      onClose()
    },
  })

  const { register, handleSubmit, formState: { isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema) as any,
    defaultValues: valuation
      ? {
          valuation_date: valuation.valuation_date,
          amount: valuation.amount,
          source: valuation.source as typeof SOURCES[number],
          notes: valuation.notes ?? '',
        }
      : {
          valuation_date: today(),
          source: 'self',
        },
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold">{valuation ? 'Edit Valuation' : 'Add Valuation'}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit(d => mutation.mutateAsync(d))} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Date *</label>
              <input type="date" {...register('valuation_date')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Value (£) *</label>
              <input type="number" step="1000" {...register('amount')} className={inputCls} placeholder="60000" />
            </div>
          </div>
          <div>
            <label className={labelCls}>Source</label>
            <select {...register('source')} className={inputCls}>
              {SOURCES.map(s => (
                <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Notes</label>
            <input {...register('notes')} className={inputCls} placeholder="e.g. Rightmove estimate" />
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
