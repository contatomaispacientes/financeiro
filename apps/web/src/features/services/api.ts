import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ServiceCreateInput,
  ServiceDto,
  ServiceListItemDto,
  ServiceListQuery,
  ServiceUpdateInput,
} from '@financeiro/shared';
import { api, get, patch, post } from '@/lib/api';

type ServiceList = { data: ServiceListItemDto[] };

export const serviceKeys = {
  all: ['services'] as const,
  list: (params: object) => ['services', 'list', params] as const,
};

export function useServices(params: { status: ServiceListQuery['status']; search?: string }) {
  return useQuery({
    queryKey: serviceKeys.list(params),
    queryFn: () => get<ServiceList>('/services', params),
    placeholderData: keepPreviousData,
  });
}

function useInvalidate() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: serviceKeys.all });
}

export function useCreateService() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: ServiceCreateInput) => post<ServiceDto>('/services', input),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateService(id: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: ServiceUpdateInput) => patch<ServiceDto>(`/services/${id}`, input),
    onSuccess: () => invalidate(),
  });
}

/** Toggle inline (design da spec 02): muda a lista na hora e desfaz se a API recusar. */
export function useToggleService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => patch<ServiceDto>(`/services/${id}`, { active }),
    onMutate: async ({ id, active }) => {
      await queryClient.cancelQueries({ queryKey: serviceKeys.all });
      const previous = queryClient.getQueriesData<ServiceList>({ queryKey: serviceKeys.all });
      queryClient.setQueriesData<ServiceList>({ queryKey: serviceKeys.all }, (list) =>
        list && { data: list.data.map((s) => (s.id === id ? { ...s, active } : s)) },
      );
      return { previous };
    },
    onError: (_error, _vars, context) => {
      for (const [key, data] of context?.previous ?? []) queryClient.setQueryData(key, data);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: serviceKeys.all }),
  });
}

export function useDeleteService() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/services/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidate(),
  });
}
