import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import type { Settings } from '@/types'

export const settingsKeys = {
  all: ['settings'] as const,
}

export function useSettings() {
  return useQuery({
    queryKey: settingsKeys.all,
    queryFn: () => api.get<Settings>('/settings'),
  })
}

export function useUpdateSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<Settings>) => api.put<Settings>('/settings', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: settingsKeys.all })
      // Tax affects projections — invalidate scenarios & goal pathways too
      qc.invalidateQueries({ queryKey: ['scenarios'] })
      qc.invalidateQueries({ queryKey: ['goals'] })
    },
  })
}
