import { Injectable } from '@nestjs/common';
import {
  BillingType,
  isChargeStatusEvent,
  nextChargeStatus,
  toCents,
  toSaoPauloDate,
  type ChargeRefundKind,
  type ChargeStatus,
} from '@financeiro/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { Charge, Prisma, WebhookEvent } from '../../generated/prisma/client.js';
import { DomainException } from '../../common/filters/domain-exception.filter';
import {
  AsaasWebhookPaymentSchema,
  dateOnly,
  eventInstant,
  refundedTotalCents,
  type AsaasWebhookPayment,
} from './asaas-payment';
import { refundValueUnknown, resourceNotYetKnown } from './payment-events.errors';

export type EventResult = 'APPLIED' | 'IMPORTED' | 'IGNORED' | 'IGNORED_TRANSITION' | 'UNKNOWN_RESOURCE';

/** WHK-02.2: até 5 min um evento sem cobrança local pode ser da criação em andamento. */
const CREATION_WINDOW_MS = 5 * 60_000;

interface LedgerEntry {
  kind: ChargeRefundKind;
  valueCents: number;
}

/** Aplica um `webhook_events` de cobrança no espelho local (spec 04, design › Processamento). */
@Injectable()
export class PaymentEventProcessor {
  constructor(private readonly prisma: PrismaService) {}

  /** `lastAttempt`: na última tentativa não adia mais — evento sem cobrança vira `UNKNOWN_RESOURCE`. */
  async apply(webhookEventId: string, { lastAttempt = true }: { lastAttempt?: boolean } = {}): Promise<EventResult | null> {
    const evt = await this.prisma.webhookEvent.findUnique({ where: { id: webhookEventId } });
    if (!evt || evt.processedAt) return null;

    await this.prisma.webhookEvent.update({ where: { id: evt.id }, data: { attempts: { increment: 1 } } });
    try {
      return await this.process(evt, lastAttempt);
    } catch (error) {
      await this.prisma.webhookEvent.update({ where: { id: evt.id }, data: { error: errorMessage(error) } });
      throw error;
    }
  }

  private async process(evt: WebhookEvent, lastAttempt: boolean): Promise<EventResult> {
    const body = evt.payload as { dateCreated?: unknown; payment?: unknown };
    if (!body.payment || !isChargeStatusEvent(evt.event)) return this.finish(this.prisma, evt.id, 'IGNORED');

    const payment = AsaasWebhookPaymentSchema.parse(body.payment);
    const mayBeCreating = !lastAttempt && Date.now() - evt.receivedAt.getTime() < CREATION_WINDOW_MS;

    // Importação de cobrança de assinatura (`payment.subscription`) é a tarefa 7 (M3).
    const chargeId = await this.locate(payment);
    if (!chargeId) {
      if (mayBeCreating) throw resourceNotYetKnown();
      return this.finish(this.prisma, evt.id, 'UNKNOWN_RESOURCE');
    }

    const at = eventInstant(body.dateCreated, evt.receivedAt);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM charges WHERE id = ${chargeId}::uuid FOR UPDATE`;
      const charge = await tx.charge.findUniqueOrThrow({ where: { id: chargeId } });
      // Rascunho = a criação ainda não gravou a resposta do Asaas (Tx 2); não disputar com ela.
      if (charge.status === 'DRAFT' && mayBeCreating) throw resourceNotYetKnown();

      const transition = nextChargeStatus(charge.status, evt.event, payment.status);
      if (transition.kind !== 'APPLY') return this.finish(tx, evt.id, 'IGNORED_TRANSITION');

      const entry = ledgerEntry(charge, transition.status, evt.event, payment);
      await tx.charge.update({
        where: { id: charge.id },
        data: chargeChanges(charge, transition.status, evt.event, payment, at, entry),
      });
      if (entry) {
        await tx.chargeRefund.create({
          data: {
            chargeId: charge.id,
            kind: entry.kind,
            valueCents: entry.valueCents,
            refundedAt: dateOnly(toSaoPauloDate(at)),
            webhookEventId: evt.id,
          },
        });
      }
      return this.finish(tx, evt.id, 'APPLIED');
    });
  }

  /** WHK-02.2: id do Asaas → externalReference → parcela (grupo ou parcelamento + número). */
  private async locate(payment: AsaasWebhookPayment): Promise<string | null> {
    const select = { id: true } as const;
    const byId = await this.prisma.charge.findUnique({ where: { asaasPaymentId: payment.id }, select });
    if (byId) return byId.id;

    const ref = payment.externalReference;
    if (ref) {
      const byRef = await this.prisma.charge.findUnique({ where: { externalReference: ref }, select });
      if (byRef) return byRef.id;
    }

    // O Asaas recebe `grp_x` para o grupo e o espelho guarda `grp_x:n`; o id do parcelamento pode não estar gravado.
    if (payment.installmentNumber && (ref || payment.installment)) {
      const byInstallment = await this.prisma.charge.findFirst({
        where: {
          installmentNumber: payment.installmentNumber,
          OR: [
            ...(ref ? [{ groupKey: ref }] : []),
            ...(payment.installment ? [{ asaasInstallmentId: payment.installment }] : []),
          ],
        },
        select,
      });
      if (byInstallment) return byInstallment.id;
    }
    return null;
  }

  private async finish(db: Prisma.TransactionClient, id: string, result: EventResult): Promise<EventResult> {
    await db.webhookEvent.update({ where: { id }, data: { processedAt: new Date(), result, error: null } });
    return result;
  }
}

function chargeChanges(
  charge: Charge,
  status: ChargeStatus,
  event: string,
  payment: AsaasWebhookPayment,
  at: Date,
  entry: LedgerEntry | null,
): Prisma.ChargeUpdateInput {
  const data: Prisma.ChargeUpdateInput = {
    status,
    lastEventAt: at,
    // Achada por externalReference/parcela: a partir daqui é localizada direto pelo id do Asaas.
    asaasPaymentId: charge.asaasPaymentId ?? payment.id,
    asaasInstallmentId: charge.asaasInstallmentId ?? payment.installment ?? null,
  };
  if (payment.invoiceUrl) data.invoiceUrl = payment.invoiceUrl;
  if (payment.bankSlipUrl) data.bankSlipUrl = payment.bankSlipUrl;
  if (payment.billingType && payment.billingType in BillingType) data.billingType = payment.billingType as BillingType;
  if (payment.netValue != null) data.netValueCents = toCents(payment.netValue);

  // WHK-02.4. Não sobrescreve: cartão CONFIRMED → PAID mantém a data da confirmação (spec 06).
  if (!charge.paidAt && (status === 'PAID' || status === 'CONFIRMED')) {
    const paidOn =
      status === 'CONFIRMED'
        ? (payment.confirmedDate ?? payment.clientPaymentDate)
        : (payment.paymentDate ?? payment.clientPaymentDate);
    if (paidOn) data.paidAt = dateOnly(paidOn);
  }

  if (event === 'PAYMENT_UPDATED') {
    if (payment.value != null) data.valueCents = toCents(payment.value);
    if (payment.dueDate) data.dueDate = dateOnly(payment.dueDate);
  }
  if (entry?.kind === 'REFUND') data.refundedCents = charge.refundedCents + entry.valueCents;
  return data;
}

/** WHK-02.7, ADR-011: lançamento em `charge_refunds` que a transição gera (no máximo um por evento). */
function ledgerEntry(charge: Charge, to: ChargeStatus, event: string, payment: AsaasWebhookPayment): LedgerEntry | null {
  const from = charge.status;
  const balance = charge.valueCents - charge.refundedCents;
  let entry: LedgerEntry | null = null;

  if (to === 'REFUNDED' && from !== 'REFUNDED') entry = { kind: 'REFUND', valueCents: balance };
  else if (to === 'PARTIALLY_REFUNDED') {
    // Valor deste estorno = total estornado segundo o Asaas − o que já foi lançado (estornos parciais sucessivos).
    const total = refundedTotalCents(payment);
    if (total === null && event === 'PAYMENT_PARTIALLY_REFUNDED') throw refundValueUnknown();
    if (total !== null) entry = { kind: 'REFUND', valueCents: total - charge.refundedCents };
  } else if (to === 'CHARGEBACK' && from !== 'CHARGEBACK') entry = { kind: 'CHARGEBACK', valueCents: balance };
  else if (from === 'CHARGEBACK' && to === 'PAID') entry = { kind: 'CHARGEBACK_REVERSAL', valueCents: balance };

  return entry && entry.valueCents > 0 ? entry : null;
}

function errorMessage(error: unknown): string {
  if (error instanceof DomainException) return error.code;
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}
