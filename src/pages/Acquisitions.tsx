import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DndContext, DragEndEvent, closestCenter, useDroppable, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Plus, X, TrendingUp, Pencil, Trash2 } from 'lucide-react'
import { api } from '@/services/api'
import { PageLoader } from '@/components/shared/LoadingSpinner'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { formatCurrency, formatPercent } from '@/utils/currency'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import type { AcquisitionOpportunity, AcquisitionStage } from '@/types'

const STAGES: { id: AcquisitionStage; label: string; color: string }[] = [
  { id: 'spotted', label: 'Spotted', color: 'border-t-slate-400' },
  { id: 'researching', label: 'Researching', color: 'border-t-blue-400' },
  { id: 'viewing_booked', label: 'Viewing', color: 'border-t-violet-400' },
  { id: 'offer_made', label: 'Offer Made', color: 'border-t-amber-400' },
  { id: 'under_offer', label: 'Under Offer', color: 'border-t-orange-400' },
  { id: 'due_diligence', label: 'Due Diligence', color: 'border-t-yellow-400' },
  { id: 'exchanged', label: 'Exchanged', color: 'border-t-green-400' },
  { id: 'rejected', label: 'Rejected', color: 'border-t-red-400' },
]

const oppSchema = z.object({
  address: z.string().min(1),
  town: z.string().optional(),
  postcode: z.string().optional(),
  property_type: z.enum(['house','flat','hmo','commercial','land']),
  bedrooms: z.coerce.number().optional(),
  asking_price: z.coerce.number().optional(),
  estimated_value: z.coerce.number().optional(),
  expected_rent: z.coerce.number().optional(),
  repair_costs: z.coerce.number().default(0),
  deposit_percent: z.coerce.number().default(25),
  mortgage_rate: z.coerce.number().default(5.5),
  notes: z.string().optional(),
  agent_name: z.string().optional(),
})

type OppFormData = z.infer<typeof oppSchema>
const inputCls = 'w-full px-3 py-2 rounded-md bg-input border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary'
const labelCls = 'block text-xs font-medium text-muted-foreground mb-1'

export default function Acquisitions() {
  const qc = useQueryClient()
  const { data: opportunities, isLoading } = useQuery({
    queryKey: ['acquisitions'],
    queryFn: () => api.get<AcquisitionOpportunity[]>('/acquisitions'),
  })
  const [selectedOpp, setSelectedOpp] = useState<AcquisitionOpportunity | null>(null)
  const [editOpp, setEditOpp] = useState<AcquisitionOpportunity | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)

  const updateStage = useMutation({
    mutationFn: ({ id, stage }: { id: number; stage: string }) => api.patch(`/acquisitions/${id}/stage`, { stage }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['acquisitions'] }),
  })

  const deleteOpp = useMutation({
    mutationFn: (id: number) => api.delete(`/acquisitions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['acquisitions'] }),
  })

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over) return
    const oppId = active.id as number
    // over.id is either a stage column id or another card id — resolve to stage
    const overStage = STAGES.find(s => s.id === over.id)
      ?? STAGES.find(s => oppsByStage(s.id).some(o => o.id === over.id))
    if (overStage) {
      const card = (opportunities ?? []).find(o => o.id === oppId)
      if (card && card.stage !== overStage.id) {
        updateStage.mutate({ id: oppId, stage: overStage.id })
      }
    }
  }

  if (isLoading) return <PageLoader />

  const oppsByStage = (stage: AcquisitionStage) =>
    (opportunities ?? []).filter(o => o.stage === stage)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Acquisition Pipeline</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{opportunities?.length ?? 0} opportunities tracked</p>
        </div>
        <button onClick={() => setShowAddForm(true)} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium">
          <Plus size={16} /> Add Opportunity
        </button>
      </div>

      {/* Kanban */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-4">
          {STAGES.map(stage => (
            <StageColumn key={stage.id} stage={stage} cards={oppsByStage(stage.id)} onCardClick={setSelectedOpp} />
          ))}
        </div>
      </DndContext>

      {/* Detail sheet */}
      {selectedOpp && (
        <OpportunitySheet
          opp={selectedOpp}
          onClose={() => setSelectedOpp(null)}
          onEdit={() => { setEditOpp(selectedOpp); setSelectedOpp(null) }}
          onDelete={() => { deleteOpp.mutate(selectedOpp.id); setSelectedOpp(null) }}
        />
      )}

      {/* Add / edit form */}
      {(showAddForm || editOpp) && (
        <OppFormModal opp={editOpp ?? undefined} onClose={() => { setShowAddForm(false); setEditOpp(null) }} />
      )}
    </div>
  )
}

function StageColumn({ stage, cards, onCardClick }: { stage: typeof STAGES[number]; cards: AcquisitionOpportunity[]; onCardClick: (o: AcquisitionOpportunity) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id })
  return (
    <div className={`flex-shrink-0 w-56 bg-card rounded-lg border-t-2 ${stage.color}`}>
      <div className="px-3 py-2.5 border-b border-border flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground">{stage.label}</span>
        <span className="text-xs text-muted-foreground bg-muted rounded px-1.5 py-0.5">{cards.length}</span>
      </div>
      <SortableContext items={cards.map(c => c.id)} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className={`p-2 space-y-2 min-h-[60px] rounded-b-lg transition-colors ${isOver ? 'bg-primary/10' : ''}`}>
          {cards.map(opp => (
            <KanbanCard key={opp.id} opp={opp} onClick={() => onCardClick(opp)} />
          ))}
        </div>
      </SortableContext>
    </div>
  )
}

function KanbanCard({ opp, onClick }: { opp: AcquisitionOpportunity; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: opp.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }
  const m = opp.metrics

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className="bg-background rounded-md p-3 cursor-pointer hover:ring-1 hover:ring-primary/50 transition-all"
    >
      <p className="text-xs font-medium text-foreground leading-snug mb-2">{opp.address}</p>
      {opp.asking_price && (
        <p className="text-xs text-muted-foreground">{formatCurrency(opp.asking_price, true)}</p>
      )}
      {m && m.gross_yield > 0 && (
        <div className="flex items-center gap-1 mt-1.5">
          <TrendingUp size={10} className="text-green-400" />
          <span className="text-xs text-green-400 font-medium">{formatPercent(m.gross_yield)} yield</span>
        </div>
      )}
      {m && (
        <div className="text-[10px] text-muted-foreground mt-1">
          {m.net_cashflow >= 0 ? `+${formatCurrency(m.net_cashflow)}/mo` : `${formatCurrency(m.net_cashflow)}/mo`}
        </div>
      )}
    </div>
  )
}

function OpportunitySheet({ opp, onClose, onEdit, onDelete }: { opp: AcquisitionOpportunity; onClose: () => void; onEdit: () => void; onDelete: () => void }) {
  const m = opp.metrics
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
      <div className="w-[480px] bg-card h-full overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-card">
          <h2 className="text-base font-semibold">Opportunity Details</h2>
          <div className="flex items-center gap-2">
            <button onClick={onEdit} className="flex items-center gap-1.5 px-3 py-1.5 bg-muted text-foreground rounded-md text-xs hover:bg-accent"><Pencil size={12} /> Edit</button>
            <button onClick={() => { if (confirm('Delete this opportunity?')) onDelete() }} className="flex items-center gap-1.5 px-3 py-1.5 text-red-400 hover:bg-red-400/10 rounded-md text-xs"><Trash2 size={12} /> Delete</button>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground ml-1"><X size={18} /></button>
          </div>
        </div>
        <div className="p-6 space-y-6">
          <div>
            <h3 className="text-lg font-bold text-foreground">{opp.address}</h3>
            {opp.town && <p className="text-sm text-muted-foreground">{opp.town}{opp.postcode ? ` · ${opp.postcode}` : ''}</p>}
            <div className="flex gap-2 mt-2">
              <StatusBadge status={opp.stage} />
              <StatusBadge status={opp.property_type} />
              {opp.bedrooms && <span className="text-xs text-muted-foreground">{opp.bedrooms} bed</span>}
            </div>
          </div>

          {m && (
            <div className="bg-background rounded-lg p-4 space-y-3">
              <h4 className="text-sm font-semibold text-foreground">Deal Analysis</h4>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {[
                  ['Asking Price', opp.asking_price ? formatCurrency(opp.asking_price) : '—'],
                  ['Est. Value', opp.estimated_value ? formatCurrency(opp.estimated_value) : '—'],
                  ['Deposit Required', formatCurrency(m.deposit_required)],
                  ['Mortgage Amount', formatCurrency(m.mortgage_amount)],
                  ['Monthly Mortgage', formatCurrency(m.monthly_mortgage)],
                  ['Expected Rent', opp.expected_rent ? formatCurrency(opp.expected_rent) + '/mo' : '—'],
                  ['Net Cashflow', (m.net_cashflow >= 0 ? '+' : '') + formatCurrency(m.net_cashflow) + '/mo'],
                  ['Gross Yield', formatPercent(m.gross_yield)],
                  ['ROI', formatPercent(m.roi)],
                  ['Potential Equity', m.potential_equity !== 0 ? formatCurrency(m.potential_equity) : '—'],
                  ['Repair Costs', formatCurrency(opp.repair_costs)],
                  ['Total Cash In', formatCurrency(m.total_invested)],
                ].map(([k, v]) => (
                  <div key={k}>
                    <div className="text-xs text-muted-foreground">{k}</div>
                    <div className={`text-sm font-semibold ${k === 'Net Cashflow' ? (m.net_cashflow >= 0 ? 'text-green-400' : 'text-red-400') : 'text-foreground'}`}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {opp.notes && (
            <div>
              <h4 className="text-sm font-semibold mb-2">Notes</h4>
              <p className="text-sm text-muted-foreground">{opp.notes}</p>
            </div>
          )}

          {(opp.agent_name || opp.agent_phone) && (
            <div>
              <h4 className="text-sm font-semibold mb-2">Agent</h4>
              <p className="text-sm text-muted-foreground">{opp.agent_name}{opp.agent_phone ? ` · ${opp.agent_phone}` : ''}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function OppFormModal({ onClose, opp }: { onClose: () => void; opp?: AcquisitionOpportunity }) {
  const qc = useQueryClient()
  const mutation = useMutation({
    mutationFn: (data: any) => opp ? api.put(`/acquisitions/${opp.id}`, data) : api.post('/acquisitions', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['acquisitions'] }); onClose() },
  })
  const { register, handleSubmit, formState: { isSubmitting } } = useForm<OppFormData>({
    resolver: zodResolver(oppSchema) as any,
    defaultValues: opp ? {
      address: opp.address, town: opp.town ?? '', postcode: opp.postcode ?? '',
      property_type: opp.property_type as any, bedrooms: opp.bedrooms ?? undefined,
      asking_price: opp.asking_price ?? undefined, estimated_value: opp.estimated_value ?? undefined,
      expected_rent: opp.expected_rent ?? undefined, repair_costs: opp.repair_costs ?? 0,
      deposit_percent: opp.deposit_percent ?? 25, mortgage_rate: opp.mortgage_rate ?? 5.5,
      notes: opp.notes ?? '', agent_name: opp.agent_name ?? '',
    } : { property_type: 'house', deposit_percent: 25, mortgage_rate: 5.5, repair_costs: 0 },
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold">{opp ? 'Edit Opportunity' : 'Add Opportunity'}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit(d => mutation.mutateAsync(d))} className="p-6 space-y-4">
          <div>
            <label className={labelCls}>Address *</label>
            <input {...register('address')} className={inputCls} placeholder="14 High Street, Manchester" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Town</label>
              <input {...register('town')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Postcode</label>
              <input {...register('postcode')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Type</label>
              <select {...register('property_type')} className={inputCls}>
                <option value="house">House</option>
                <option value="flat">Flat</option>
                <option value="hmo">HMO</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Bedrooms</label>
              <input type="number" {...register('bedrooms')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Asking Price (£)</label>
              <input type="number" {...register('asking_price')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Est. Value (£)</label>
              <input type="number" {...register('estimated_value')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Expected Rent (£/mo)</label>
              <input type="number" {...register('expected_rent')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Repair Costs (£)</label>
              <input type="number" {...register('repair_costs')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Deposit (%)</label>
              <input type="number" step="0.5" {...register('deposit_percent')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Mortgage Rate (%)</label>
              <input type="number" step="0.01" {...register('mortgage_rate')} className={inputCls} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Agent Name</label>
            <input {...register('agent_name')} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Notes</label>
            <textarea {...register('notes')} className={inputCls} rows={3} />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-border rounded-md text-sm text-muted-foreground">Cancel</button>
            <button type="submit" disabled={isSubmitting} className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium disabled:opacity-50">{opp ? 'Save' : 'Add'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
