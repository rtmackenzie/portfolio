import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import type { Property, PropertyDetail } from '@/types'

export const propertyKeys = {
  all: ['properties'] as const,
  lists: () => [...propertyKeys.all, 'list'] as const,
  detail: (id: number) => [...propertyKeys.all, 'detail', id] as const,
}

export function useProperties() {
  return useQuery({
    queryKey: propertyKeys.lists(),
    queryFn: () => api.get<Property[]>('/properties'),
  })
}

export function useProperty(id: number) {
  return useQuery({
    queryKey: propertyKeys.detail(id),
    queryFn: () => api.get<PropertyDetail>(`/properties/${id}`),
    enabled: !!id,
  })
}

export function useCreateProperty() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<Property>) => api.post<Property>('/properties', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: propertyKeys.lists() })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

export function useUpdateProperty(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<Property>) => api.put<Property>(`/properties/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: propertyKeys.lists() })
      qc.invalidateQueries({ queryKey: propertyKeys.detail(id) })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

export function useDeleteProperty() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/properties/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: propertyKeys.all })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}
