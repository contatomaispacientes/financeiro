import { describe, it, expect } from 'vitest';
import { chargeStatusFromAsaas, isChargeStatusEvent, nextChargeStatus } from '../charge-status.js';
import { ChargeStatus } from '../enums.js';

const STATUSES = Object.values(ChargeStatus);

// Mapa do overview.md, escrito por evento. Tudo o que não está aqui é IGNORED_TRANSITION.
const ALLOWED: Array<[ChargeStatus, string, ChargeStatus]> = [
  ['DRAFT', 'PAYMENT_CREATED', 'PENDING'],
  ['PENDING', 'PAYMENT_CREATED', 'PENDING'],
  ['PENDING', 'PAYMENT_CONFIRMED', 'CONFIRMED'],
  ['OVERDUE', 'PAYMENT_CONFIRMED', 'CONFIRMED'],
  ['PENDING', 'PAYMENT_RECEIVED', 'PAID'],
  ['OVERDUE', 'PAYMENT_RECEIVED', 'PAID'],
  ['CONFIRMED', 'PAYMENT_RECEIVED', 'PAID'],
  ['CHARGEBACK', 'PAYMENT_RECEIVED', 'PAID'],
  ['PENDING', 'PAYMENT_OVERDUE', 'OVERDUE'],
  ['PENDING', 'PAYMENT_DELETED', 'CANCELED'],
  ['OVERDUE', 'PAYMENT_DELETED', 'CANCELED'],
  ['CANCELED', 'PAYMENT_RESTORED', 'PENDING'],
  ['PAID', 'PAYMENT_REFUNDED', 'REFUNDED'],
  ['CONFIRMED', 'PAYMENT_REFUNDED', 'REFUNDED'],
  ['PARTIALLY_REFUNDED', 'PAYMENT_REFUNDED', 'REFUNDED'],
  ['PAID', 'PAYMENT_PARTIALLY_REFUNDED', 'PARTIALLY_REFUNDED'],
  ['PARTIALLY_REFUNDED', 'PAYMENT_PARTIALLY_REFUNDED', 'PARTIALLY_REFUNDED'],
  ['PAID', 'PAYMENT_CHARGEBACK_REQUESTED', 'CHARGEBACK'],
  ['CONFIRMED', 'PAYMENT_CHARGEBACK_REQUESTED', 'CHARGEBACK'],
];

const STATUS_EVENTS = [...new Set(ALLOWED.map(([, event]) => event))];

describe('nextChargeStatus', () => {
  describe('[WHK-02.3] todas as combinações status × evento', () => {
    for (const current of STATUSES) {
      for (const event of STATUS_EVENTS) {
        const allowed = ALLOWED.find(([from, e]) => from === current && e === event);
        it(`${current} + ${event} → ${allowed ? allowed[2] : 'IGNORED_TRANSITION'}`, () => {
          expect(nextChargeStatus(current, event)).toEqual(
            allowed ? { kind: 'APPLY', status: allowed[2] } : { kind: 'IGNORED_TRANSITION' },
          );
        });
      }
    }
  });

  it('[WHK-02.3] dois estornos parciais seguidos e depois o total', () => {
    let status: ChargeStatus = 'PAID';
    for (const event of ['PAYMENT_PARTIALLY_REFUNDED', 'PAYMENT_PARTIALLY_REFUNDED', 'PAYMENT_REFUNDED']) {
      const t = nextChargeStatus(status, event);
      expect(t.kind).toBe('APPLY');
      if (t.kind === 'APPLY') status = t.status;
    }
    expect(status).toBe('REFUNDED');
  });

  it('[WHK-02.3] chargeback e reversão (ADR-011)', () => {
    expect(nextChargeStatus('PAID', 'PAYMENT_CHARGEBACK_REQUESTED')).toEqual({ kind: 'APPLY', status: 'CHARGEBACK' });
    expect(nextChargeStatus('CHARGEBACK', 'PAYMENT_RECEIVED')).toEqual({ kind: 'APPLY', status: 'PAID' });
  });

  it('[WHK-02.3] OVERDUE chegando depois de RECEIVED é ignorado', () => {
    expect(nextChargeStatus('PAID', 'PAYMENT_OVERDUE')).toEqual({ kind: 'IGNORED_TRANSITION' });
  });

  it('PAYMENT_RESTORED de cobrança vencida volta como OVERDUE', () => {
    expect(nextChargeStatus('CANCELED', 'PAYMENT_RESTORED', 'OVERDUE')).toEqual({ kind: 'APPLY', status: 'OVERDUE' });
    expect(nextChargeStatus('CANCELED', 'PAYMENT_RESTORED', 'PENDING')).toEqual({ kind: 'APPLY', status: 'PENDING' });
  });

  describe('PAYMENT_UPDATED', () => {
    it('sem mudança de status é aplicado (auto-transição)', () => {
      expect(nextChargeStatus('PENDING', 'PAYMENT_UPDATED', 'PENDING')).toEqual({ kind: 'APPLY', status: 'PENDING' });
      expect(nextChargeStatus('PAID', 'PAYMENT_UPDATED', 'REFUND_IN_PROGRESS')).toEqual({ kind: 'APPLY', status: 'PAID' });
    });

    it('com status diferente segue o mapa', () => {
      expect(nextChargeStatus('PENDING', 'PAYMENT_UPDATED', 'RECEIVED')).toEqual({ kind: 'APPLY', status: 'PAID' });
      expect(nextChargeStatus('PAID', 'PAYMENT_UPDATED', 'PENDING')).toEqual({ kind: 'IGNORED_TRANSITION' });
      expect(nextChargeStatus('OVERDUE', 'PAYMENT_UPDATED', 'PENDING')).toEqual({ kind: 'IGNORED_TRANSITION' });
    });

    it('não restaura cobrança cancelada nem tira do rascunho', () => {
      expect(nextChargeStatus('CANCELED', 'PAYMENT_UPDATED', 'PENDING')).toEqual({ kind: 'IGNORED_TRANSITION' });
      expect(nextChargeStatus('DRAFT', 'PAYMENT_UPDATED', 'PENDING')).toEqual({ kind: 'IGNORED_TRANSITION' });
    });
  });

  it('eventos fora do mapa só são registrados', () => {
    for (const event of ['PAYMENT_CHECKOUT_VIEWED', 'PAYMENT_BANK_SLIP_VIEWED', 'PAYMENT_CHARGEBACK_DISPUTE', 'PAYMENT_REFUND_IN_PROGRESS']) {
      expect(isChargeStatusEvent(event)).toBe(false);
      expect(nextChargeStatus('PAID', event)).toEqual({ kind: 'RECORD_ONLY' });
    }
  });

  it('converte o status do Asaas', () => {
    expect(chargeStatusFromAsaas('RECEIVED_IN_CASH')).toBe('PAID');
    expect(chargeStatusFromAsaas('AWAITING_CHARGEBACK_REVERSAL')).toBe('CHARGEBACK');
    expect(chargeStatusFromAsaas('AWAITING_RISK_ANALYSIS')).toBeNull();
  });
});
