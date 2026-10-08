import { roleLabels } from '@/lib/format';

export const entityLabels: Record<string, string> = {
  user: 'Usuários',
  settings: 'Configurações',
  integration: 'Integrações',
};

export const actionLabels: Record<string, string> = {
  'auth.login': 'Entrou no sistema',
  'auth.login_failed': 'Tentativa de login recusada',
  'user.create': 'Criou usuário',
  'user.update': 'Alterou usuário',
  'user.reset_password': 'Redefiniu senha',
  'settings.update': 'Alterou configurações',
  'integration.asaas_test': 'Testou conexão com o Asaas',
};

export const fieldLabels: Record<string, string> = {
  name: 'Nome',
  email: 'E-mail',
  role: 'Papel',
  active: 'Ativo',
  companyName: 'Nome da empresa',
  companyDocument: 'CPF/CNPJ da empresa',
  companyCity: 'Cidade',
  defaultDueDays: 'Vencimento padrão (dias)',
  defaultFinePct: 'Multa (%)',
  defaultInterestPct: 'Juros ao mês (%)',
  contractChargeDueDays: 'Vencimento após assinatura (dias)',
  reminderDaysBefore: 'Lembrete antes (dias)',
  reminderOnDueDate: 'Lembrete no vencimento',
  reminderDaysAfter: 'Lembretes após (dias)',
  reminderChannels: 'Canais da régua',
  companySignerName: 'Signatário da empresa',
  companySignerEmail: 'E-mail do signatário',
  companySignerPhone: 'Celular do signatário',
};

export const loginFailureReasons: Record<string, string> = {
  UNKNOWN_EMAIL: 'e-mail não cadastrado',
  WRONG_PASSWORD: 'senha incorreta',
  INACTIVE: 'usuário inativo',
};

export function formatAuditValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (field === 'role' && typeof value === 'string' && value in roleLabels) {
    return roleLabels[value as keyof typeof roleLabels];
  }
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
