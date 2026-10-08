import { addCycle, type BillingType } from '@financeiro/shared';
import { Prisma } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service';
import { toDateOnly } from '../customers/customers.mapper';
import { fromDateOnly, statusFromAsaas } from '../charges/charges.mapper';

/** Cobrança de assinatura vinda do Asaas (resposta da API ou webhook), já em centavos. */
export interface ImportablePayment {
  id: string;
  subscription: string;
  status: string;
  billingType: BillingType;
  valueCents: number;
  netValueCents: number | null;
  dueDate: string;
  paymentDate: string | null;
  invoiceUrl: string | null;
  bankSlipUrl: string | null;
  deleted: boolean;
}

/**
 * COB-04.2/COB-04.3 (WHK, tarefa 7): espelha uma cobrança gerada pela assinatura, com os itens dela,
 * e avança `next_due_date`. Idempotente por `asaas_payment_id`: criação e webhook podem importar a mesma
 * cobrança ao mesmo tempo. Devolve `null` se a assinatura não é nossa.
 */
export async function importSubscriptionPayment(
  prisma: PrismaService,
  payment: ImportablePayment,
): Promise<{ chargeId: string; imported: boolean } | null> {
  const existing = await prisma.charge.findUnique({ where: { asaasPaymentId: payment.id }, select: { id: true } });
  if (existing) return { chargeId: existing.id, imported: false };

  const sub = await prisma.subscription.findUnique({ where: { asaasSubscriptionId: payment.subscription }, include: { items: true } });
  if (!sub || payment.deleted) return null;

  try {
    const charge = await prisma.charge.create({
      data: {
        customerId: sub.customerId,
        contractId: sub.contractId,
        subscriptionId: sub.id,
        origin: 'SUBSCRIPTION',
        type: 'RECURRING',
        status: statusFromAsaas(payment.status),
        billingType: payment.billingType,
        valueCents: payment.valueCents,
        netValueCents: payment.netValueCents,
        finePct: sub.finePct,
        interestPct: sub.interestPct,
        dueDate: fromDateOnly(payment.dueDate),
        paidAt: payment.paymentDate ? fromDateOnly(payment.paymentDate) : null,
        description: sub.description,
        externalReference: `${sub.externalReference}:${payment.id}`,
        asaasPaymentId: payment.id,
        invoiceUrl: payment.invoiceUrl,
        bankSlipUrl: payment.bankSlipUrl,
        items: {
          create: sub.items.map((i) => ({
            serviceId: i.serviceId,
            description: i.description,
            quantity: i.quantity,
            unitPriceCents: i.unitPriceCents,
            totalCents: i.totalCents,
          })),
        },
      },
      select: { id: true },
    });
    if (payment.dueDate >= toDateOnly(sub.nextDueDate)) {
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { nextDueDate: fromDateOnly(addCycle(payment.dueDate, sub.cycle)) },
      });
    }
    return { chargeId: charge.id, imported: true };
  } catch (error) {
    // Importada em paralelo (criação × webhook): fica a que chegou primeiro.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const winner = await prisma.charge.findUniqueOrThrow({ where: { asaasPaymentId: payment.id }, select: { id: true } });
      return { chargeId: winner.id, imported: false };
    }
    throw error;
  }
}
