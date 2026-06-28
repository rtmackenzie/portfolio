import { useState } from 'react'
import type { RiskFactor, RiskBand } from '@/types'

const BAND_CELL: Record<RiskBand, string> = {
  low: 'bg-emerald-500/10',
  medium: 'bg-amber-500/10',
  high: 'bg-orange-500/15',
  critical: 'bg-red-500/20',
}
const BAND_CHIP: Record<RiskBand, string> = {
  low: 'bg-emerald-500/15 text-emerald-400',
  medium: 'bg-amber-500/15 text-amber-400',
  high: 'bg-orange-500/15 text-orange-400',
  critical: 'bg-red-500/15 text-red-400',
}
const BAND_DOT: Record<RiskBand, string> = {
  low: 'bg-emerald-500',
  medium: 'bg-amber-500',
  high: 'bg-orange-500',
  critical: 'bg-red-500',
}
const bandOfSeverity = (sev: number): RiskBand => (sev <= 4 ? 'low' : sev <= 9 ? 'medium' : sev <= 14 ? 'high' : 'critical')

const rows = [5, 4, 3, 2, 1]
const cols = [1, 2, 3, 4, 5]

export function RiskHeatmap({ factors }: { factors: RiskFactor[] }) {
  const [hover, setHover] = useState<string | null>(null)
  // 1-based number per factor, matching the marker labels
  const numbered = factors.map((f, i) => ({ ...f, n: i + 1 }))

  return (
    <div className="grid grid-cols-12 gap-6 items-start">
      {/* Matrix */}
      <div className="col-span-12 lg:col-span-5">
        <div className="flex">
          <div className="flex items-center justify-center pr-1">
            <span className="text-[10px] text-muted-foreground -rotate-90 whitespace-nowrap tracking-wide uppercase">Likelihood →</span>
          </div>
          <div className="flex-1">
            <div className="grid gap-1" style={{ gridTemplateColumns: '18px repeat(5, 1fr)' }}>
              {rows.flatMap(L => [
                <div key={`l${L}`} className="flex items-center justify-center text-[10px] text-muted-foreground">{L}</div>,
                ...cols.map(I => {
                  const band = bandOfSeverity(L * I)
                  const here = numbered.filter(f => f.likelihood === L && f.impact === I)
                  return (
                    <div key={`${L}-${I}`} className={`aspect-square rounded ${BAND_CELL[band]} border border-border/40 flex flex-wrap gap-0.5 items-center justify-center p-1`}>
                      {here.map(f => (
                        <button
                          key={f.key}
                          onMouseEnter={() => setHover(f.key)}
                          onMouseLeave={() => setHover(null)}
                          title={`${f.label}: L${f.likelihood}×I${f.impact}`}
                          className={`w-5 h-5 rounded-full text-[10px] font-bold text-white flex items-center justify-center ${BAND_DOT[f.band]} ${hover === f.key ? 'ring-2 ring-foreground' : ''}`}
                        >{f.n}</button>
                      ))}
                    </div>
                  )
                }),
              ])}
              <div />
              {cols.map(I => <div key={`c${I}`} className="text-center text-[10px] text-muted-foreground">{I}</div>)}
            </div>
            <div className="text-center text-[10px] text-muted-foreground tracking-wide uppercase mt-1">Impact →</div>
          </div>
        </div>
      </div>

      {/* Factor list with mitigation notes */}
      <div className="col-span-12 lg:col-span-7 space-y-2">
        {numbered
          .slice()
          .sort((a, b) => b.severity - a.severity)
          .map(f => (
            <div
              key={f.key}
              onMouseEnter={() => setHover(f.key)}
              onMouseLeave={() => setHover(null)}
              className={`rounded-lg border p-3 ${hover === f.key ? 'border-foreground/40 bg-accent/40' : 'border-border'}`}
            >
              <div className="flex items-center gap-2">
                <span className={`w-5 h-5 rounded-full text-[10px] font-bold text-white flex items-center justify-center ${BAND_DOT[f.band]}`}>{f.n}</span>
                <span className="text-sm font-medium">{f.label}</span>
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${BAND_CHIP[f.band]}`}>{f.band}</span>
                <span className="text-[11px] text-muted-foreground ml-auto">L{f.likelihood} × I{f.impact} = {f.severity}</span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">{f.rationale}</p>
              <p className="text-[11px] mt-1"><span className="font-medium text-foreground">Mitigation:</span> <span className="text-muted-foreground">{f.mitigation}</span></p>
            </div>
          ))}
      </div>
    </div>
  )
}
