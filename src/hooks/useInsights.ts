import { useQuery } from '@tanstack/react-query'
import { api } from '@/services/api'
import type { InsightsResult } from '@/types'

// Keyed under ['dashboard', …] so it recomputes on every change that invalidates
// ['dashboard'] — same free refresh as the scorecard and risk heatmap.
export function useInsights() {
  return useQuery({
    queryKey: ['dashboard', 'insights'],
    queryFn: () => api.get<InsightsResult>('/dashboard/insights'),
    refetchInterval: 1000 * 60 * 5,
  })
}
