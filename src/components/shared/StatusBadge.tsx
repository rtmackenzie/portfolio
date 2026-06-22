import { cn } from '@/lib/utils'

type StatusVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

const STATUS_MAP: Record<string, StatusVariant> = {
  // Properties
  let: 'success', owned: 'info', vacant: 'warning', under_offer: 'warning', sold: 'neutral',
  // Tenants
  active: 'success', ended: 'neutral', notice_given: 'warning',
  // Payments
  paid: 'success', pending: 'warning', late: 'danger', partial: 'warning', missed: 'danger',
  // Maintenance
  completed: 'success', in_progress: 'info', cancelled: 'neutral',
  // Certificates
  valid: 'success', expired: 'danger', due_soon: 'warning', missing: 'danger',
  // Mortgage
  fixed: 'info', tracker: 'warning', repayment: 'success', interest_only: 'warning',
}

const VARIANT_STYLES: Record<StatusVariant, string> = {
  success: 'bg-green-500/15 text-green-400 border border-green-500/30',
  warning: 'bg-amber-500/15 text-amber-400 border border-amber-500/30',
  danger: 'bg-red-500/15 text-red-400 border border-red-500/30',
  info: 'bg-blue-500/15 text-blue-400 border border-blue-500/30',
  neutral: 'bg-muted text-muted-foreground border border-border',
}

const LABELS: Record<string, string> = {
  let: 'Let', owned: 'Owned', vacant: 'Vacant', under_offer: 'Under Offer', sold: 'Sold',
  active: 'Active', ended: 'Ended', notice_given: 'Notice Given',
  paid: 'Paid', pending: 'Pending', late: 'Late', partial: 'Partial', missed: 'Missed',
  completed: 'Completed', in_progress: 'In Progress', cancelled: 'Cancelled',
  valid: 'Valid', expired: 'Expired', due_soon: 'Due Soon', missing: 'Missing',
  fixed: 'Fixed', tracker: 'Tracker', repayment: 'Repayment', interest_only: 'Interest Only',
  gas_safety: 'Gas Safety', epc: 'EPC', electrical: 'Electrical', eicr: 'EICR',
  pat: 'PAT', fire_risk: 'Fire Risk', legionella: 'Legionella', hmo_licence: 'HMO Licence',
}

interface StatusBadgeProps {
  status: string
  className?: string
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const variant = STATUS_MAP[status] ?? 'neutral'
  const label = LABELS[status] ?? status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
      VARIANT_STYLES[variant],
      className
    )}>
      {label}
    </span>
  )
}
