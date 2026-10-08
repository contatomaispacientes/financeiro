import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ChargeCreateRequest,
  ChargeCreateResponseDto,
  ChargeDetailDto,
  ChargePreviewDto,
  CustomerDetailDto,
  CustomerListItemDto,
  Paginated,
  PaymentInfoDto,
  ServiceListItemDto,
} from '@financeiro/shared';
import { get, post } from '@/lib/api';
import { customerKeys } from '@/features/customers/api';

export const chargeKeys = {
  all: ['charges'] as const,
  detail: (id: string) => ['charge', id] as const,
  paymentInfo: (id: string) => ['charge', id, 'payment-info'] as const,
};

/** Criar, tentar de novo e descartar invalidam lista, detalhe, ficha do cliente e dashboard (design da spec 03). */
function useInvalidate() {
  const queryClient = useQueryClient();
  return (customerId?: string, chargeIds: string[] = []) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: chargeKeys.all }),
      ...chargeIds.map((id) => queryClient.invalidateQueries({ queryKey: chargeKeys.detail(id) })),
      queryClient.invalidateQueries({ queryKey: customerKeys.all }),
      customerId ? queryClient.invalidateQueries({ queryKey: customerKeys.detail(customerId) }) : undefined,
      queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
    ]);
}

export function useCharge(id: string) {
  return useQuery({ queryKey: chargeKeys.detail(id), queryFn: () => get<ChargeDetailDto>(`/charges/${id}`) });
}

/** Pix e linha digitável sob demanda quando faltaram na criação (COB-05.2). */
export function usePaymentInfo(id: string, enabled: boolean) {
  return useQuery({
    queryKey: chargeKeys.paymentInfo(id),
    queryFn: () => get<PaymentInfoDto>(`/charges/${id}/payment-info`),
    enabled,
    staleTime: 5 * 60_000,
  });
}

/** Prévia sem efeitos colaterais (COB-01.4); `null` enquanto o formulário não forma um plano válido. */
export function useChargePreview(request: ChargeCreateRequest | null) {
  return useQuery({
    queryKey: ['charge-preview', request],
    queryFn: () => post<ChargePreviewDto>('/charges/preview', request),
    enabled: request !== null,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useCreateCharge() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (request: ChargeCreateRequest) => post<ChargeCreateResponseDto>('/charges', request),
    // Também na falha: o rascunho DRAFT já existe e aparece na ficha do cliente.
    onSettled: (_data, _error, request) => invalidate(request.customerId),
  });
}

export function useChargeAction() {
  const queryClient = useQueryClient();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'retry' | 'discard' }) =>
      post<ChargeDetailDto>(`/charges/${id}/${action}`),
    onSuccess: (charge) => {
      queryClient.setQueryData(chargeKeys.detail(charge.id), charge);
      return invalidate(charge.customer.id, [charge.id]);
    },
  });
}

export function useActiveServices() {
  return useQuery({
    queryKey: ['services', 'list', { status: 'active' }],
    queryFn: () => get<{ data: ServiceListItemDto[] }>('/services', { status: 'active' }),
  });
}

/** `?cliente=<id>` vindo da ficha do cliente. */
export function usePreselectedCustomer(id: string | null) {
  return useQuery({
    queryKey: customerKeys.detail(id ?? ''),
    queryFn: () => get<CustomerDetailDto>(`/customers/${id}`),
    enabled: id !== null,
  });
}

export const CUSTOMER_PICKER_SIZE = 8;

/** Arquivados não vêm (padrão da API, CLI-02.3): cliente arquivado não recebe cobrança. */
export function useCustomerSearch(search: string, enabled: boolean) {
  return useQuery({
    queryKey: customerKeys.list({ search, picker: true }),
    queryFn: () =>
      get<Paginated<CustomerListItemDto>>('/customers', {
        search: search || undefined,
        pageSize: CUSTOMER_PICKER_SIZE,
      }),
    enabled,
    placeholderData: keepPreviousData,
  });
}
