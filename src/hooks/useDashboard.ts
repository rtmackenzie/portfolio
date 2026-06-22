import { useQuery } from '@tanstack/react-query'
import { api } from '@/services/api'
import type { DashboardData } from '@/types'

export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardData>('/dashboard/kpis'),
    refetchInterval: 1000 * 60 * 5,
  })
}
