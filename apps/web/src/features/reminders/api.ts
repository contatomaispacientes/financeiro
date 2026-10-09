import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ReminderListDto,
  ReminderPreviewDto,
  ReminderPreviewInput,
  ReminderTemplateDto,
  ReminderTemplateUpsertInput,
} from '@financeiro/shared';
import { api, get, post } from '@/lib/api';

const templatesKey = ['reminder-templates'] as const;

export function useReminders(filters: { chargeId?: string; days?: number; page?: number }, enabled = true) {
  return useQuery({
    queryKey: ['reminders', filters],
    queryFn: () => get<ReminderListDto>('/reminders', { ...filters, pageSize: 50 }),
    enabled,
  });
}

export function useReminderTemplates() {
  return useQuery({ queryKey: templatesKey, queryFn: () => get<ReminderTemplateDto[]>('/reminder-templates') });
}

export function useReminderMutations() {
  const qc = useQueryClient();
  const onSuccess = () => qc.invalidateQueries({ queryKey: templatesKey });
  return {
    upsert: useMutation({ mutationFn: (input: Partial<ReminderTemplateUpsertInput>) => api<ReminderTemplateDto>('/reminder-templates', { method: 'PUT', body: input }), onSuccess }),
    remove: useMutation({ mutationFn: (id: string) => api(`/reminder-templates/${id}`, { method: 'DELETE' }), onSuccess }),
    reset: useMutation({ mutationFn: (id: string) => post<ReminderTemplateDto>(`/reminder-templates/${id}/reset`), onSuccess }),
    preview: useMutation({ mutationFn: (input: ReminderPreviewInput) => post<ReminderPreviewDto>('/reminder-templates/preview', input) }),
    run: useMutation({
      mutationFn: () => post<{ queued: number }>('/reminders/run', {}),
      onSuccess: () => setTimeout(() => void qc.invalidateQueries({ queryKey: ['reminders'] }), 1500),
    }),
  };
}
