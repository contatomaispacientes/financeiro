import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ConnectionTestResult,
  IntegrationsStatusDto,
  SettingsDto,
  SettingsUpdateInput,
} from '@financeiro/shared';
import { get, patch, post } from '@/lib/api';

export const settingsKeys = {
  settings: ['settings'] as const,
  integrations: ['settings', 'integrations'] as const,
};

export function useSettings() {
  return useQuery({ queryKey: settingsKeys.settings, queryFn: () => get<SettingsDto>('/settings') });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SettingsUpdateInput) => patch<SettingsDto>('/settings', input),
    onSuccess: (data) => queryClient.setQueryData(settingsKeys.settings, data),
  });
}

export function useIntegrations(enabled: boolean) {
  return useQuery({
    queryKey: settingsKeys.integrations,
    queryFn: () => get<IntegrationsStatusDto>('/settings/integrations'),
    enabled,
  });
}

export function useTestAsaas() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => post<ConnectionTestResult>('/settings/integrations/asaas/test'),
    onSettled: () => queryClient.invalidateQueries({ queryKey: settingsKeys.integrations }),
  });
}
