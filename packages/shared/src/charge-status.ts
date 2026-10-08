import { ChargeStatus } from './enums.js';

const S = ChargeStatus;

/** Mapa de transições (docs/architecture/overview.md) por evento de cobrança do Asaas. */
const RULES: Record<string, { from: readonly ChargeStatus[]; to: ChargeStatus }> = {
  PAYMENT_CREATED: { from: [S.DRAFT, S.PENDING], to: S.PENDING },
  PAYMENT_CONFIRMED: { from: [S.PENDING, S.OVERDUE], to: S.CONFIRMED },
  // De CHARGEBACK: disputa ganha e valor devolvido (ADR-011).
  PAYMENT_RECEIVED: { from: [S.PENDING, S.OVERDUE, S.CONFIRMED, S.CHARGEBACK], to: S.PAID },
  PAYMENT_OVERDUE: { from: [S.PENDING], to: S.OVERDUE },
  PAYMENT_DELETED: { from: [S.PENDING, S.OVERDUE], to: S.CANCELED },
  PAYMENT_RESTORED: { from: [S.CANCELED], to: S.PENDING },
  PAYMENT_REFUNDED: { from: [S.PAID, S.CONFIRMED, S.PARTIALLY_REFUNDED], to: S.REFUNDED },
  PAYMENT_PARTIALLY_REFUNDED: { from: [S.PAID, S.PARTIALLY_REFUNDED], to: S.PARTIALLY_REFUNDED },
  PAYMENT_CHARGEBACK_REQUESTED: { from: [S.PAID, S.CONFIRMED], to: S.CHARGEBACK },
};

/** Status do `payment` no Asaas → status do espelho local. Ausentes não mudam o status local. */
const FROM_ASAAS: Record<string, ChargeStatus> = {
  PENDING: S.PENDING,
  CONFIRMED: S.CONFIRMED,
  RECEIVED: S.PAID,
  RECEIVED_IN_CASH: S.PAID,
  DUNNING_RECEIVED: S.PAID,
  OVERDUE: S.OVERDUE,
  DUNNING_REQUESTED: S.OVERDUE,
  REFUNDED: S.REFUNDED,
  CHARGEBACK_REQUESTED: S.CHARGEBACK,
  CHARGEBACK_DISPUTE: S.CHARGEBACK,
  AWAITING_CHARGEBACK_REVERSAL: S.CHARGEBACK,
};

export type ChargeTransition =
  | { kind: 'APPLY'; status: ChargeStatus } // `status` pode ser o atual (auto-transição: aplica os demais campos)
  | { kind: 'IGNORED_TRANSITION' }
  | { kind: 'RECORD_ONLY' }; // evento que só aparece no histórico

export function chargeStatusFromAsaas(asaasStatus: string | null | undefined): ChargeStatus | null {
  return (asaasStatus && FROM_ASAAS[asaasStatus]) || null;
}

/** Eventos que podem mudar o espelho da cobrança; os demais só são registrados. */
export function isChargeStatusEvent(event: string): boolean {
  return event in RULES || event === 'PAYMENT_UPDATED';
}

/**
 * WHK-02.3: próximo status da cobrança local para um evento do Asaas.
 * `paymentStatus` é o `payment.status` do payload: define o destino de `PAYMENT_UPDATED` e de
 * `PAYMENT_RESTORED` (volta como `OVERDUE` se a cobrança restaurada já venceu).
 */
export function nextChargeStatus(
  current: ChargeStatus,
  event: string,
  paymentStatus?: string | null,
): ChargeTransition {
  if (!isChargeStatusEvent(event)) return { kind: 'RECORD_ONLY' };
  // Rascunho só sai pela confirmação de que o Asaas aceitou a cobrança.
  if (current === S.DRAFT && event !== 'PAYMENT_CREATED') return { kind: 'IGNORED_TRANSITION' };

  if (event === 'PAYMENT_UPDATED') {
    const target = chargeStatusFromAsaas(paymentStatus);
    if (!target || target === current) return { kind: 'APPLY', status: current };
    // Mudança de status só por um caminho que um evento "de avanço" faria; restaurar exige PAYMENT_RESTORED.
    const reachable = Object.entries(RULES).some(
      ([name, rule]) =>
        name !== 'PAYMENT_RESTORED' && rule.to === target && rule.from.includes(current),
    );
    return reachable ? { kind: 'APPLY', status: target } : { kind: 'IGNORED_TRANSITION' };
  }

  const rule = RULES[event]!;
  if (!rule.from.includes(current)) return { kind: 'IGNORED_TRANSITION' };
  if (event === 'PAYMENT_RESTORED' && paymentStatus === 'OVERDUE') {
    return { kind: 'APPLY', status: S.OVERDUE };
  }
  return { kind: 'APPLY', status: rule.to };
}
