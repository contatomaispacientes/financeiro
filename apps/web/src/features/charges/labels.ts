import type { BillingType, ChargeDetailDto, ChargeEventDto, ChargeOrigin } from '@financeiro/shared';

export const billingTypeLabels: Record<BillingType, string> = {
  PIX: 'Pix',
  BOLETO: 'Boleto',
  CREDIT_CARD: 'Cartão',
  UNDEFINED: 'Cliente escolhe',
};

export const originLabels: Record<ChargeOrigin, string> = {
  MANUAL: 'Manual',
  CONTRACT: 'Contrato',
  SUBSCRIPTION: 'Recorrência',
};

export function chargeTypeLabel(c: Pick<ChargeDetailDto, 'type' | 'installmentNumber' | 'installmentCount'>) {
  if (c.type === 'INSTALLMENT') return `Parcela ${c.installmentNumber}/${c.installmentCount}`;
  return c.type === 'RECURRING' ? 'Recorrente' : 'Avulsa';
}

/** Eventos de cobrança do Asaas (docs/integrations/asaas.md) em português (WHK-03.4). */
const eventLabels: Record<string, string> = {
  PAYMENT_CREATED: 'Cobrança criada',
  PAYMENT_UPDATED: 'Cobrança alterada',
  PAYMENT_CONFIRMED: 'Pagamento confirmado',
  PAYMENT_RECEIVED: 'Pagamento recebido',
  PAYMENT_OVERDUE: 'Cobrança vencida',
  PAYMENT_DELETED: 'Cobrança removida',
  PAYMENT_RESTORED: 'Cobrança restaurada',
  PAYMENT_REFUNDED: 'Pagamento estornado',
  PAYMENT_PARTIALLY_REFUNDED: 'Estorno parcial',
  PAYMENT_REFUND_IN_PROGRESS: 'Estorno em andamento',
  PAYMENT_CHARGEBACK_REQUESTED: 'Chargeback aberto',
  PAYMENT_CHARGEBACK_DISPUTE: 'Chargeback em disputa',
  PAYMENT_AWAITING_CHARGEBACK_REVERSAL: 'Aguardando devolução do chargeback',
  PAYMENT_CHECKOUT_VIEWED: 'Fatura visualizada pelo cliente',
  PAYMENT_BANK_SLIP_VIEWED: 'Boleto visualizado pelo cliente',
  PAYMENT_AWAITING_RISK_ANALYSIS: 'Em análise de risco',
  PAYMENT_APPROVED_BY_RISK_ANALYSIS: 'Aprovado na análise de risco',
  PAYMENT_REPROVED_BY_RISK_ANALYSIS: 'Reprovado na análise de risco',
};

export function eventLabel(event: string): string {
  if (eventLabels[event]) return eventLabels[event];
  if (event.startsWith('RECONCILE_')) return 'Corrigido pela reconciliação';
  return 'Evento do Asaas';
}

/** Situação do processamento, só quando foge do normal (aplicado). */
export function eventNote(e: ChargeEventDto): string | null {
  if (!e.processedAt) return 'Aguardando processamento';
  if (e.result === 'IGNORED_TRANSITION') return 'Ignorado: chegou fora de ordem';
  if (e.result === 'IGNORED') return 'Só registrado';
  return null;
}
