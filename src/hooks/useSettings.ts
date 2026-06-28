import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import type { TaxSettings } from '@/types'

export const settingsKeys = {
  all: ['settings'] as const,
}

export function useSettings() {
  return useQuery({
    queryKey: settingsKeys.all,
    queryFn: () => api.get<TaxSettings>('/settings'),
  })
}

export function useUpdateSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<TaxSettings>) => api.put<TaxSettings>('/settings', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: settingsKeys.all })
      // Tax affects projections — invalidate scenarios & goal pathways too
      qc.invalidateQueries({ queryKey: ['scenarios'] })
      qc.invalidateQueries({ queryKey: ['goals'] })
    },
  })
}
