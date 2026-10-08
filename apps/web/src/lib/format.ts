import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export { formatBRL } from '@financeiro/shared';

/** "2026-10-07" (DATE) → "07/10/2026". Sem fuso: vencimento é data pura. */
export function formatDate(date: string): string {
  const [y, m, d] = date.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/** Instante ISO (UTC) → "07/10/2026 14:32" no horário local. */
export function formatDateTime(iso: string): string {
  return format(parseISO(iso), 'dd/MM/yyyy HH:mm', { locale: ptBR });
}

export const roleLabels = {
  ADMIN: 'Administrador',
  FINANCEIRO: 'Financeiro',
  LEITURA: 'Leitura',
} as const;
