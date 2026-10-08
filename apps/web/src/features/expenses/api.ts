import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CategoryDto,
  CategoryInput,
  ExpenseCreateInput,
  ExpenseDto,
  ExpenseListDto,
  ExpensePayInput,
  ExpenseState,
  ExpenseUpdateInput,
  RecurrenceCreateInput,
  RecurrenceDto,
  RecurrenceUpdateInput,
} from '@financeiro/shared';
import { api, get, patch, post } from '@/lib/api';

export const EXPENSES_PAGE_SIZE = 20;

export interface ExpenseFilters {
  state?: ExpenseState;
  categoryId?: string;
  search?: string;
  page: number;
}

export function useExpenses(filters: ExpenseFilters) {
  return useQuery({
    queryKey: ['expenses', 'list', filters],
    queryFn: () => get<ExpenseListDto>('/expenses', { ...filters, pageSize: EXPENSES_PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
}

export function useCategories() {
  return useQuery({ queryKey: ['expense-categories'], queryFn: () => get<CategoryDto[]>('/expense-categories'), staleTime: 300_000 });
}

export function useRecurrences() {
  return useQuery({ queryKey: ['expense-recurrences'], queryFn: () => get<RecurrenceDto[]>('/expense-recurrences') });
}

/** Qualquer mudança em despesas mexe nos KPIs e no dashboard. */
function useInvalidate() {
  const qc = useQueryClient();
  return () =>
    Promise.all(['expenses', 'expense-recurrences', 'dashboard', 'cashflow'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
}

export function useExpenseMutations() {
  const invalidate = useInvalidate();
  const opts = { onSuccess: invalidate };
  return {
    create: useMutation({ mutationFn: (input: ExpenseCreateInput) => post<ExpenseDto>('/expenses', input), ...opts }),
    update: useMutation({
      mutationFn: ({ id, input }: { id: string; input: ExpenseUpdateInput }) => patch<ExpenseDto>(`/expenses/${id}`, input),
      ...opts,
    }),
    pay: useMutation({
      mutationFn: ({ id, input }: { id: string; input: ExpensePayInput }) => post<ExpenseDto>(`/expenses/${id}/pay`, input),
      ...opts,
    }),
    unpay: useMutation({ mutationFn: (id: string) => post<ExpenseDto>(`/expenses/${id}/unpay`), ...opts }),
    cancel: useMutation({ mutationFn: (id: string) => post<ExpenseDto>(`/expenses/${id}/cancel`), ...opts }),
    attach: useMutation({
      mutationFn: ({ id, file }: { id: string; file: File }) => {
        const form = new FormData();
        form.append('file', file);
        return post<ExpenseDto>(`/expenses/${id}/attachment`, form);
      },
      ...opts,
    }),
    detach: useMutation({ mutationFn: (id: string) => api<ExpenseDto>(`/expenses/${id}/attachment`, { method: 'DELETE' }), ...opts }),
    createRecurrence: useMutation({
      mutationFn: (input: RecurrenceCreateInput) => post<RecurrenceDto>('/expense-recurrences', input),
      ...opts,
    }),
    updateRecurrence: useMutation({
      mutationFn: ({ id, input }: { id: string; input: RecurrenceUpdateInput }) =>
        patch<RecurrenceDto>(`/expense-recurrences/${id}`, input),
      ...opts,
    }),
  };
}

export function useCategoryMutations() {
  const qc = useQueryClient();
  const onSuccess = () => qc.invalidateQueries({ queryKey: ['expense-categories'] });
  return {
    create: useMutation({ mutationFn: (input: CategoryInput) => post<CategoryDto>('/expense-categories', input), onSuccess }),
    update: useMutation({
      mutationFn: ({ id, input }: { id: string; input: Partial<CategoryInput> }) =>
        patch<CategoryDto>(`/expense-categories/${id}`, input),
      onSuccess,
    }),
    remove: useMutation({ mutationFn: (id: string) => api<void>(`/expense-categories/${id}`, { method: 'DELETE' }), onSuccess }),
  };
}
