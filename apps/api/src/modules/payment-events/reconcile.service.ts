import { Inject, Injectable, Logger } from '@nestjs/common';
import { addDays, fromCents, todayInSaoPaulo, type ChargeStatus } from '@financeiro/shared';
import type { Charge } from '../../generated/prisma/client.js';
import { ASAAS_CLIENT, type AsaasClient, type AsaasPayment } from '../../integrations/asaas/asaas.client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { toDateOnly } from '../customers/customers.mapper';
import { fromDateOnly } from '../charges/charges.mapper';
import { importSubscriptionPayment } from '../subscriptions/subscription-import';
import { PaymentEventProcessor } from './payment-event-processor.service';

export interface ReconcileSummary {
  checked: number;
  fixed: number;
  imported: number;
  errors: number;
}

const CONCURRENCY = 3; // WHK-04.5
const RETENTION_MONTHS = 18; // WHK-NF3

const FROM_ASAAS: Record<string, ChargeStatus> = {
  PENDING: 'PENDING',
  OVERDUE: 'OVERDUE',
  CONFIRMED: 'CONFIRMED',
  RECEIVED: 'PAID',
  RECEIVED_IN_CASH: 'PAID',
  REFUNDED: 'REFUNDED',
  CHARGEBACK_REQUESTED: 'CHARGEBACK',
  CHARGEBACK_DISPUTE: 'CHARGEBACK',
  AWAITING_CHARGEBACK_REVERSAL: 'CHARGEBACK',
};
const EVENT_FOR: Partial<Record<ChargeStatus, string>> = {
  PAID: 'PAYMENT_RECEIVED',
  CONFIRMED: 'PAYMENT_CONFIRMED',
  OVERDUE: 'PAYMENT_OVERDUE',
  REFUNDED: 'PAYMENT_REFUNDED',
  CHARGEBACK: 'PAYMENT_CHARGEBACK_REQUESTED',
};

/** Evento equivalente à divergência entre o espelho e o Asaas; `null` = nada a corrigir. */
export function reconcileEvent(local: Pick<Charge, 'status' | 'valueCents' | 'dueDate'>, remote: AsaasPayment): string | null {
  if (remote.deleted) return local.status === 'CANCELED' ? null : 'PAYMENT_DELETED';
  const target = FROM_ASAAS[remote.status];
  if (target && target !== local.status) {
    if (target === 'PENDING') return local.status === 'CANCELED' ? 'PAYMENT_RESTORED' : 'PAYMENT_UPDATED';
    return EVENT_FOR[target] ?? null;
  }
  if (remote.valueCents !== local.valueCents || remote.dueDate !== toDateOnly(local.dueDate)) return 'PAYMENT_UPDATED';
  return null;
}

/** Payload no formato do webhook (valores em reais), para o mesmo processador. */
function webhookPayment(p: AsaasPayment) {
  return {
    object: 'payment',
    id: p.id,
    customer: p.customer,
    status: p.status,
    billingType: p.billingType,
    value: fromCents(p.valueCents),
    netValue: p.netValueCents === null ? null : fromCents(p.netValueCents),
    dueDate: p.dueDate,
    paymentDate: p.paymentDate,
    clientPaymentDate: p.paymentDate,
    confirmedDate: p.status === 'CONFIRMED' ? p.paymentDate : null,
    externalReference: p.externalReference,
    installment: p.installment,
    installmentNumber: p.installmentNumber,
    subscription: p.subscription,
    invoiceUrl: p.invoiceUrl,
    bankSlipUrl: p.bankSlipUrl,
    deleted: p.deleted,
  };
}

/** WHK-04 (ADR-007): rede de segurança do webhook. Divergência vira evento RECONCILE no log. */
@Injectable()
export class ReconcileService {
  private readonly logger = new Logger(ReconcileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly processor: PaymentEventProcessor,
    @Inject(ASAAS_CLIENT) private readonly asaas: AsaasClient,
  ) {}

  async run(trigger: 'CRON' | 'MANUAL', userId?: string): Promise<ReconcileSummary> {
    const today = todayInSaoPaulo();
    const charges = await this.prisma.charge.findMany({
      where: {
        asaasPaymentId: { not: null },
        OR: [
          { status: { in: ['PENDING', 'OVERDUE', 'CONFIRMED'] } },
          { status: { in: ['PAID', 'PARTIALLY_REFUNDED', 'CHARGEBACK'] }, paidAt: { gte: fromDateOnly(addDays(today, -120)) } },
          { status: 'CANCELED', updatedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
        ],
      },
      select: { id: true },
    });

    const summary: ReconcileSummary = { checked: 0, fixed: 0, imported: 0, errors: 0 };
    const queue = charges.map((c) => c.id);
    const worker = async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        try {
          summary.checked++;
          if (await this.check(id, today)) summary.fixed++;
        } catch (error) {
          summary.errors++;
          this.logger.warn(`Reconciliação da cobrança ${id} falhou: ${error instanceof Error ? error.message : error}`);
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    // WHK-04.2: cobranças de assinaturas ativas que o webhook não trouxe.
    const subs = await this.prisma.subscription.findMany({ where: { status: 'ACTIVE', asaasSubscriptionId: { not: null } }, select: { asaasSubscriptionId: true } });
    for (const s of subs) {
      try {
        const page = await this.asaas.listPayments({ subscription: s.asaasSubscriptionId!, limit: 100 });
        for (const p of page.data) {
          const result = await importSubscriptionPayment(this.prisma, { ...p, subscription: s.asaasSubscriptionId! });
          if (result?.imported) summary.imported++;
        }
      } catch {
        summary.errors++;
      }
    }

    await this.audit.record({ userId, action: 'reconcile.run', entity: 'reconcile', data: { trigger, ...summary } });
    return summary;
  }

  /** COB-07.2 ("Atualizar do Asaas"): uma cobrança, pelo mesmo caminho. */
  async sync(chargeId: string): Promise<boolean> {
    return this.check(chargeId, todayInSaoPaulo());
  }

  /** WHK-NF3: apaga eventos com mais de 18 meses. */
  async prune(): Promise<number> {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - RETENTION_MONTHS);
    const { count } = await this.prisma.webhookEvent.deleteMany({ where: { receivedAt: { lt: cutoff }, processedAt: { not: null } } });
    return count;
  }

  private async check(chargeId: string, today: string): Promise<boolean> {
    const local = await this.prisma.charge.findUniqueOrThrow({ where: { id: chargeId } });
    if (!local.asaasPaymentId) return false;
    const remote = await this.asaas.getPayment(local.asaasPaymentId);
    const event = reconcileEvent(local, remote);
    if (!event) return false;

    // Estado remoto + local: a mesma divergência no mesmo dia não duplica, uma nova divergência gera outro evento.
    const externalEventId = `rec:${remote.id}:${remote.status}:${remote.valueCents}:${remote.dueDate}:${local.status}:${local.valueCents}:${today}`;
    const row = await this.prisma.webhookEvent.upsert({
      where: { source_externalEventId: { source: 'RECONCILE', externalEventId } },
      create: { source: 'RECONCILE', externalEventId, event, resourceId: remote.id, payload: { event, payment: webhookPayment(remote) } },
      update: {},
    });
    const result = await this.processor.apply(row.id);
    return result === 'APPLIED' || result === 'IMPORTED';
  }
}
