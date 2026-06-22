import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { X } from 'lucide-react'
import { useCreateProperty, useUpdateProperty } from '@/hooks/useProperties'
import type { Property } from '@/types'

const schema = z.object({
  address_line1: z.string().min(1, 'Required'),
  address_line2: z.string().optional(),
  town: z.string().min(1, 'Required'),
  county: z.string().optional(),
  postcode: z.string().min(1, 'Required'),
  purchase_date: z.string().optional(),
  purchase_price: z.coerce.number().positive().optional().or(z.literal('')),
  current_value: z.coerce.number().positive().optional().or(z.literal('')),
  property_type: z.enum(['house', 'flat', 'hmo', 'commercial', 'land']),
  bedrooms: z.coerce.number().int().min(0),
  bathrooms: z.coerce.number().int().min(0),
  status: z.enum(['owned', 'under_offer', 'sold', 'vacant', 'let']),
  notes: z.string().optional(),
})

type FormData = z.infer<typeof schema>

interface Props {
  property?: Property
  onClose: () => void
}

const inputCls = 'w-full px-3 py-2 rounded-md bg-input border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary'
const labelCls = 'block text-xs font-medium text-muted-foreground mb-1'
const errorCls = 'text-xs text-red-400 mt-1'

export function PropertyForm({ property, onClose }: Props) {
  const create = useCreateProperty()
  const update = useUpdateProperty(property?.id ?? 0)

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema) as any,
    defaultValues: property ? {
      address_line1: property.address_line1,
      address_line2: property.address_line2 ?? '',
      town: property.town,
      county: property.county ?? '',
      postcode: property.postcode,
      purchase_date: property.purchase_date ?? '',
      purchase_price: property.purchase_price ?? undefined,
      current_value: property.current_value ?? undefined,
      property_type: property.property_type,
      bedrooms: property.bedrooms,
      bathrooms: property.bathrooms,
      status: property.status,
      notes: property.notes ?? '',
    } : { property_type: 'house', bedrooms: 3, bathrooms: 1, status: 'owned' },
  })

  async function onSubmit(data: FormData) {
    const payload = { ...data, purchase_price: data.purchase_price || undefined, current_value: data.current_value || undefined }
    if (property) {
      await update.mutateAsync(payload)
    } else {
      await create.mutateAsync(payload)
    }
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">{property ? 'Edit Property' : 'Add Property'}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className={labelCls}>Address Line 1 *</label>
              <input {...register('address_line1')} className={inputCls} placeholder="42 Bramhall Lane" />
              {errors.address_line1 && <p className={errorCls}>{errors.address_line1.message}</p>}
            </div>
            <div>
              <label className={labelCls}>Address Line 2</label>
              <input {...register('address_line2')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Town *</label>
              <input {...register('town')} className={inputCls} placeholder="Stockport" />
              {errors.town && <p className={errorCls}>{errors.town.message}</p>}
            </div>
            <div>
              <label className={labelCls}>County</label>
              <input {...register('county')} className={inputCls} placeholder="Greater Manchester" />
            </div>
            <div>
              <label className={labelCls}>Postcode *</label>
              <input {...register('postcode')} className={inputCls} placeholder="SK7 2DY" />
              {errors.postcode && <p className={errorCls}>{errors.postcode.message}</p>}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>Property Type</label>
              <select {...register('property_type')} className={inputCls}>
                <option value="house">House</option>
                <option value="flat">Flat</option>
                <option value="hmo">HMO</option>
                <option value="commercial">Commercial</option>
                <option value="land">Land</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Bedrooms</label>
              <input type="number" {...register('bedrooms')} className={inputCls} min={0} />
            </div>
            <div>
              <label className={labelCls}>Bathrooms</label>
              <input type="number" {...register('bathrooms')} className={inputCls} min={0} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>Purchase Date</label>
              <input type="date" {...register('purchase_date')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Purchase Price (£)</label>
              <input type="number" {...register('purchase_price')} className={inputCls} placeholder="185000" />
            </div>
            <div>
              <label className={labelCls}>Current Value (£)</label>
              <input type="number" {...register('current_value')} className={inputCls} placeholder="235000" />
            </div>
          </div>

          <div>
            <label className={labelCls}>Status</label>
            <select {...register('status')} className={inputCls}>
              <option value="owned">Owned</option>
              <option value="let">Let</option>
              <option value="vacant">Vacant</option>
              <option value="under_offer">Under Offer</option>
              <option value="sold">Sold</option>
            </select>
          </div>

          <div>
            <label className={labelCls}>Notes</label>
            <textarea {...register('notes')} className={inputCls} rows={3} />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-border rounded-md text-sm text-muted-foreground hover:bg-accent transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={isSubmitting} className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity">
              {isSubmitting ? 'Saving...' : property ? 'Save Changes' : 'Add Property'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
