import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import type { FinancialSummary, Expense, RentPayment } from '@/types'

export function useFinancialSummary() {
  return useQuery({
    queryKey: ['finances', 'summary'],
    queryFn: () => api.get<FinancialSummary>('/finances/summary'),
  })
}

export function useExpenses() {
  return useQuery({
    queryKey: ['finances', 'expenses'],
    queryFn: () => api.get<Expense[]>('/finances/expenses'),
  })
}

export function useCreateExpense() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<Expense>) => api.post<Expense>('/finances/expenses', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['finances'] }),
  })
}

export function useUpdateExpense(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<Expense>) => api.put<Expense>(`/finances/expenses/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['finances'] }),
  })
}

export function useDeleteExpense() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/finances/expenses/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['finances'] }),
  })
}

export function useRentPayments(propertyId?: number, status?: string) {
  return useQuery({
    queryKey: ['finances', 'rent-payments', propertyId, status],
    queryFn: () => {
      const params = new URLSearchParams()
      if (propertyId) params.set('property_id', String(propertyId))
      if (status) params.set('status', status)
      return api.get<RentPayment[]>(`/finances/rent-payments?${params}`)
    },
  })
}

export function useUpdateRentPayment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<RentPayment> }) =>
      api.put<RentPayment>(`/finances/rent-payments/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['finances', 'rent-payments'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}
