import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ContractDetailDto,
  ContractDraftInput,
  ContractListItemDto,
  ContractPreviewDto,
  ContractStatus,
  ContractTemplateDto,
  Paginated,
  TemplateUpsertInput,
} from '@financeiro/shared';
import { get, patch, post } from '@/lib/api';

export const CONTRACTS_PAGE_SIZE = 20;

export const contractKeys = {
  all: ['contracts'] as const,
  detail: (id: string) => ['contract', id] as const,
  preview: (id: string) => ['contract', id, 'preview'] as const,
  templates: ['contract-templates'] as const,
};

export function useContracts(filters: { status?: ContractStatus; customerId?: string; search?: string; page: number }) {
  return useQuery({
    queryKey: [...contractKeys.all, filters],
    queryFn: () => get<Paginated<ContractListItemDto>>('/contracts', { ...filters, pageSize: CONTRACTS_PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
}

/** Enquanto aguarda assinatura ou a cobrança, recarrega sozinho: os eventos chegam pela fila. */
export function useContract(id: string) {
  return useQuery({
    queryKey: contractKeys.detail(id),
    queryFn: () => get<ContractDetailDto>(`/contracts/${id}`),
    refetchInterval: (q) => {
      const c = q.state.data;
      if (!c) return false;
      const waiting = c.status === 'SENT' || c.status === 'PARTIALLY_SIGNED' || (c.status === 'SIGNED' && !c.chargeGeneratedAt && !c.chargeError);
      return waiting ? 4000 : false;
    },
  });
}

export function useContractPreview(id: string, enabled: boolean) {
  return useQuery({ queryKey: contractKeys.preview(id), queryFn: () => post<ContractPreviewDto>(`/contracts/${id}/preview`), enabled });
}

export function useTemplates(active?: boolean) {
  return useQuery({
    queryKey: [...contractKeys.templates, active],
    queryFn: () => get<ContractTemplateDto[]>('/contract-templates', active === undefined ? {} : { active: String(active) }),
  });
}

export function useContractMutations() {
  const qc = useQueryClient();
  const refresh = (c?: ContractDetailDto) => {
    if (c) qc.setQueryData(contractKeys.detail(c.id), c);
    return Promise.all([
      qc.invalidateQueries({ queryKey: contractKeys.all }),
      c ? qc.invalidateQueries({ queryKey: contractKeys.preview(c.id) }) : undefined,
      qc.invalidateQueries({ queryKey: ['dashboard'] }),
      qc.invalidateQueries({ queryKey: ['charges'] }),
    ]);
  };
  const action = (path: string) =>
    useMutation({ mutationFn: (id: string) => post<ContractDetailDto>(`/contracts/${id}/${path}`), onSuccess: refresh });
  return {
    create: useMutation({ mutationFn: (input: ContractDraftInput) => post<ContractDetailDto>('/contracts', input), onSuccess: refresh }),
    update: useMutation({
      mutationFn: ({ id, input }: { id: string; input: Partial<Omit<ContractDraftInput, 'customerId'>> }) => patch<ContractDetailDto>(`/contracts/${id}`, input),
      onSuccess: refresh,
    }),
    send: action('send'),
    discard: action('discard'),
    cancel: useMutation({
      mutationFn: ({ id, reason }: { id: string; reason?: string }) => post<ContractDetailDto>(`/contracts/${id}/cancel`, { reason }),
      onSuccess: refresh,
    }),
    resend: useMutation({ mutationFn: ({ id, signerId }: { id: string; signerId: string }) => post(`/contracts/${id}/signers/${signerId}/resend`) }),
    generateCharge: useMutation({
      mutationFn: (id: string) => post<{ queued: boolean }>(`/contracts/${id}/generate-charge`),
      onSuccess: (_d, id) => qc.invalidateQueries({ queryKey: contractKeys.detail(id) }),
    }),
  };
}

export function useTemplateMutations() {
  const qc = useQueryClient();
  const onSuccess = () => qc.invalidateQueries({ queryKey: contractKeys.templates });
  return {
    create: useMutation({ mutationFn: (input: TemplateUpsertInput) => post<ContractTemplateDto>('/contract-templates', input), onSuccess }),
    update: useMutation({
      mutationFn: ({ id, input }: { id: string; input: Partial<TemplateUpsertInput> }) => patch<ContractTemplateDto>(`/contract-templates/${id}`, input),
      onSuccess,
    }),
    preview: useMutation({ mutationFn: (id: string) => post<ContractPreviewDto>(`/contract-templates/${id}/preview`, {}) }),
  };
}
