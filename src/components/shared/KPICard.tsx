import { TrendingUp, TrendingDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface KPICardProps {
  label: string
  value: string | number
  subtext?: string
  trend?: { value: number; label?: string }
  icon?: React.ReactNode
  variant?: 'default' | 'success' | 'warning' | 'danger'
  className?: string
}

export function KPICard({ label, value, subtext, trend, icon, variant = 'default', className }: KPICardProps) {
  const variantStyles = {
    default: '',
    success: 'border-l-4 border-l-green-500',
    warning: 'border-l-4 border-l-amber-500',
    danger: 'border-l-4 border-l-red-500',
  }

  return (
    <div className={cn(
      'bg-card rounded-lg p-5 flex flex-col gap-2 shadow-sm',
      variantStyles[variant],
      className
    )}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        {icon && <span className="text-muted-foreground">{icon}</span>}
      </div>
      <div className="text-2xl font-bold text-foreground tracking-tight">{value}</div>
      <div className="flex items-center justify-between">
        {subtext && <span className="text-xs text-muted-foreground">{subtext}</span>}
        {trend && (
          <span className={cn(
            'flex items-center gap-0.5 text-xs font-medium',
            trend.value >= 0 ? 'text-green-500' : 'text-red-500'
          )}>
            {trend.value >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {trend.label ?? `${Math.abs(trend.value)}%`}
          </span>
        )}
      </div>
    </div>
  )
}
