import { CheckCircle2, Info, AlertTriangle, ShieldAlert } from 'lucide-react'
import type { Insight, InsightTone } from '@/types'

const TONE: Record<InsightTone, { icon: typeof Info; text: string; bg: string; chip: string }> = {
  positive: { icon: CheckCircle2,  text: 'text-emerald-400', bg: 'bg-emerald-500/10', chip: 'bg-emerald-500/15 text-emerald-400' },
  info:     { icon: Info,          text: 'text-blue-400',    bg: 'bg-blue-500/10',    chip: 'bg-blue-500/15 text-blue-400' },
  warning:  { icon: AlertTriangle, text: 'text-amber-400',   bg: 'bg-amber-500/10',   chip: 'bg-amber-500/15 text-amber-400' },
  critical: { icon: ShieldAlert,   text: 'text-red-400',     bg: 'bg-red-500/10',     chip: 'bg-red-500/15 text-red-400' },
}

export function InsightsList({ insights }: { insights: Insight[] }) {
  if (insights.length === 0) return null
  return (
    <div className="space-y-2">
      {insights.map(ins => {
        const t = TONE[ins.tone]
        const Icon = t.icon
        return (
          <div key={ins.id} className={`flex gap-3 rounded-lg p-3 ${t.bg}`}>
            <Icon size={16} className={`flex-shrink-0 mt-0.5 ${t.text}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-foreground">{ins.headline}</span>
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${t.chip}`}>{ins.category}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{ins.detail}</p>
              {ins.metrics && ins.metrics.length > 0 && (
                <div className="flex gap-3 mt-1.5 flex-wrap">
                  {ins.metrics.map(m => (
                    <span key={m.label} className="text-[11px] text-muted-foreground">
                      <span className="text-muted-foreground/70">{m.label}: </span>
                      <span className="font-medium text-foreground">{m.value}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
