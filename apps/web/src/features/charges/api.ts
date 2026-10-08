import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ChargeCancelInput,
  ChargeCreateRequest,
  ChargeCreateResponseDto,
  ChargeDetailDto,
  ChargeListDto,
  ChargeListQuery,
  ChargePreviewDto,
  ChargeStatus,
  CustomerDetailDto,
  CustomerListItemDto,
  Paginated,
  PaymentInfoDto,
  ServiceListItemDto,
  SubscriptionDetailDto,
  SubscriptionListItemDto,
  SubscriptionStatus,
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

export const CHARGES_PAGE_SIZE = 20;

export type ChargeFilters = Partial<Pick<ChargeListQuery, 'customerId' | 'type' | 'billingType' | 'dueFrom' | 'dueTo' | 'search'>> & {
  status?: ChargeStatus[];
  page: number;
};

/** COB-06 */
export function useCharges(filters: ChargeFilters) {
  return useQuery({
    queryKey: [...chargeKeys.all, 'list', filters],
    queryFn: () => get<ChargeListDto>('/charges', { ...filters, pageSize: CHARGES_PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
}

/** COB-08 e COB-09: o status final chega pelo webhook; recarrega já e de novo em seguida. */
export function useChargeMutations() {
  const queryClient = useQueryClient();
  const invalidate = useInvalidate();
  const after = (charges: ChargeDetailDto[]) => {
    for (const c of charges) queryClient.setQueryData(chargeKeys.detail(c.id), c);
    const refresh = () => invalidate(charges[0]?.customer.id, charges.map((c) => c.id));
    setTimeout(() => void refresh(), 1500);
    return refresh();
  };
  return {
    cancel: useMutation({
      mutationFn: ({ id, scope }: { id: string; scope: ChargeCancelInput['scope'] }) =>
        post<ChargeDetailDto[]>(`/charges/${id}/cancel`, { scope }),
      onSuccess: after,
    }),
    refund: useMutation({
      mutationFn: ({ id, valueCents }: { id: string; valueCents?: number }) =>
        post<ChargeDetailDto>(`/charges/${id}/refund`, valueCents === undefined ? {} : { valueCents }),
      onSuccess: (c) => after([c]),
    }),
  };
}

export const subscriptionKeys = {
  all: ['subscriptions'] as const,
  detail: (id: string) => ['subscription', id] as const,
};

export function useSubscriptions(filters: { status?: SubscriptionStatus; page: number }) {
  return useQuery({
    queryKey: [...subscriptionKeys.all, filters],
    queryFn: () => get<Paginated<SubscriptionListItemDto>>('/subscriptions', { ...filters, pageSize: CHARGES_PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
}

export function useSubscription(id: string) {
  return useQuery({ queryKey: subscriptionKeys.detail(id), queryFn: () => get<SubscriptionDetailDto>(`/subscriptions/${id}`) });
}

export function useSubscriptionAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'cancel' | 'retry' }) => post<SubscriptionDetailDto>(`/subscriptions/${id}/${action}`),
    onSuccess: (sub) => {
      queryClient.setQueryData(subscriptionKeys.detail(sub.id), sub);
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: subscriptionKeys.all }),
        queryClient.invalidateQueries({ queryKey: chargeKeys.all }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
    },
  });
}
