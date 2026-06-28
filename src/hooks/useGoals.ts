import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import type { Goal } from '@/types'

export const goalKeys = {
  all: ['goals'] as const,
  lists: () => [...goalKeys.all, 'list'] as const,
  detail: (id: number) => [...goalKeys.all, 'detail', id] as const,
}

export function useGoals() {
  return useQuery({
    queryKey: goalKeys.lists(),
    queryFn: () => api.get<Goal[]>('/goals'),
  })
}

export function useGoal(id: number) {
  return useQuery({
    queryKey: goalKeys.detail(id),
    queryFn: () => api.get<Goal>(`/goals/${id}`),
    enabled: !!id,
  })
}

export function useCreateGoal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<Goal>) => api.post<Goal>('/goals', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: goalKeys.lists() }),
  })
}

export function useUpdateGoal(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<Goal>) => api.put<Goal>(`/goals/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: goalKeys.lists() })
      qc.invalidateQueries({ queryKey: goalKeys.detail(id) })
    },
  })
}

export function useDeleteGoal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/goals/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: goalKeys.lists() }),
  })
}
