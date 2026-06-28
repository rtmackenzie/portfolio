import { useQuery } from '@tanstack/react-query'
import { api } from '@/services/api'
import type { RiskHeatmap } from '@/types'

// Keyed under ['dashboard', …] so mutations that invalidate ['dashboard'] refresh
// it — recompute-on-change for free.
export function useRiskHeatmap() {
  return useQuery({
    queryKey: ['dashboard', 'risk'],
    queryFn: () => api.get<RiskHeatmap>('/dashboard/risk'),
    refetchInterval: 1000 * 60 * 5,
  })
}
