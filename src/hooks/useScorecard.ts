import { useQuery } from '@tanstack/react-query'
import { api } from '@/services/api'
import type { Scorecard } from '@/types'

// Keyed under ['dashboard', …] so it is invalidated by every mutation that
// invalidates ['dashboard'] — recompute-on-change for free.
export function useScorecard() {
  return useQuery({
    queryKey: ['dashboard', 'scorecard'],
    queryFn: () => api.get<Scorecard>('/dashboard/scorecard'),
    refetchInterval: 1000 * 60 * 5,
  })
}
