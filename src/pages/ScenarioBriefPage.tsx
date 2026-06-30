import { useRef } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Download, ArrowLeft } from 'lucide-react'
import { api } from '@/services/api'
import { PageLoader } from '@/components/shared/LoadingSpinner'
import { ScenarioBrief, type BriefItem } from '@/components/reports/ScenarioBrief'
import { exportElementToPdf } from '@/utils/pdf'
import type { RiskHeatmap, ScenarioResults } from '@/types'

type ScenarioWithResults = BriefItem['scenario'] & { results: ScenarioResults | null }
type CompareRow = { scenario: BriefItem['scenario']; results: ScenarioResults | null }

export default function ScenarioBriefPage({ compare = false }: { compare?: boolean }) {
  const { id } = useParams()
  const [params] = useSearchParams()
  const briefRef = useRef<HTMLDivElement>(null)

  const ids = compare ? (params.get('ids') ?? '') : ''

  const single = useQuery({
    queryKey: ['scenarios', 'detail', id],
    queryFn: () => api.get<ScenarioWithResults>(`/scenarios/${id}`),
    enabled: !compare && !!id,
  })
  const comparison = useQuery({
    queryKey: ['scenarios', 'compare', ids],
    queryFn: () => api.get<CompareRow[]>(`/scenarios/compare?ids=${ids}`),
    enabled: compare && !!ids,
  })
  const risk = useQuery({
    queryKey: ['dashboard', 'risk'],
    queryFn: () => api.get<RiskHeatmap>('/dashboard/risk'),
  })

  const isLoading = (compare ? comparison.isLoading : single.isLoading) || risk.isLoading
  if (isLoading) return <PageLoader />

  // Assemble brief items (scenarios that actually have results)
  const items: BriefItem[] = compare
    ? (comparison.data ?? [])
        .filter((r): r is CompareRow & { results: ScenarioResults } => !!r.results)
        .map(r => ({ scenario: r.scenario, results: r.results }))
    : single.data?.results
      ? [{ scenario: single.data, results: single.data.results }]
      : []

  const topRisks = [...(risk.data?.factors ?? [])].sort((a, b) => b.severity - a.severity).slice(0, 3)

  const fileName = compare
    ? 'scenario-comparison.pdf'
    : `scenario-${(single.data?.name ?? 'brief').replace(/\s+/g, '-').toLowerCase()}.pdf`

  async function download() {
    if (briefRef.current) await exportElementToPdf(briefRef.current, fileName)
  }

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="no-print max-w-[794px] mx-auto mb-4 flex items-center justify-between">
        <Link to="/scenarios" className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900">
          <ArrowLeft size={15} /> Back to What-If
        </Link>
        <button
          onClick={download}
          disabled={items.length === 0}
          className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-md text-sm font-medium disabled:opacity-50"
        >
          <Download size={15} /> Download PDF
        </button>
      </div>

      <div className="mx-auto w-[794px] shadow-lg">
        {items.length === 0 ? (
          <div className="bg-white p-8 text-sm text-gray-600">
            No projection results to brief. Run the projection on the scenario(s) first.
          </div>
        ) : (
          <div ref={briefRef}>
            <ScenarioBrief items={items} topRisks={topRisks} />
          </div>
        )}
      </div>
    </div>
  )
}
