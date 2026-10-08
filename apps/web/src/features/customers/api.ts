import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CustomerCreateInput,
  CustomerDetailDto,
  CustomerDto,
  CustomerListItemDto,
  CustomerLookupDto,
  CustomerUpdateInput,
  Paginated,
} from '@financeiro/shared';
import { get, patch, post } from '@/lib/api';

export const CUSTOMERS_PAGE_SIZE = 20;

export const customerKeys = {
  all: ['customers'] as const,
  list: (params: object) => ['customers', 'list', params] as const,
  detail: (id: string) => ['customer', id] as const,
};

export function useCustomers(params: { search?: string; archived: boolean; page: number }) {
  return useQuery({
    queryKey: customerKeys.list(params),
    queryFn: () =>
      get<Paginated<CustomerListItemDto>>('/customers', {
        search: params.search,
        archived: params.archived,
        page: params.page,
        pageSize: CUSTOMERS_PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
  });
}

export function useCustomer(id: string) {
  return useQuery({ queryKey: customerKeys.detail(id), queryFn: () => get<CustomerDetailDto>(`/customers/${id}`) });
}

export const lookupDocument = (document: string) => get<CustomerLookupDto>('/customers/lookup', { document });

/** Criar/editar invalidam a lista e a ficha (design da spec 01). */
function useInvalidate() {
  const queryClient = useQueryClient();
  return (id?: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: customerKeys.all }),
      id ? queryClient.invalidateQueries({ queryKey: customerKeys.detail(id) }) : undefined,
    ]);
}

export function useCreateCustomer() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: CustomerCreateInput) => post<CustomerDto>('/customers', input),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateCustomer(id: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: CustomerUpdateInput) => patch<CustomerDto>(`/customers/${id}`, input),
    onSuccess: () => invalidate(id),
  });
}

export function useCustomerAction(id: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (action: 'archive' | 'unarchive' | 'asaas-sync') => post<CustomerDto | undefined>(`/customers/${id}/${action}`),
    onSuccess: () => invalidate(id),
  });
}
