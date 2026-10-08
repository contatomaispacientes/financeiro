import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  todayInSaoPaulo,
  type ChargePlan,
  type Paginated,
  type PlanCalculation,
  type SubscriptionDetailDto,
  type SubscriptionListItemDto,
  type SubscriptionListQuery,
} from '@financeiro/shared';
import { ASAAS_CLIENT, type AsaasClient } from '../../integrations/asaas/asaas.client';
import { AsaasError } from '../../integrations/asaas/http-asaas.client';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CustomersService } from '../customers/customers.service';
import { toDateOnly } from '../customers/customers.mapper';
import {
  retryDueDateInPast,
  subscriptionAlreadySent,
  subscriptionNotCancelable,
  subscriptionNotFound,
} from '../charges/charges.errors';
import { fromDateOnly, toSubscriptionDetailDto, toSubscriptionListItemDto } from '../charges/charges.mapper';
import { importSubscriptionPayment } from './subscription-import';

const listInclude = { customer: { select: { id: true, name: true } } } as const;
const chargeListInclude = {
  customer: { select: { id: true, name: true } },
  subscription: { select: { cycle: true } },
} as const;

/** Recorrências (COB-04, COB-11): assinatura local ↔ `subscription` do Asaas. */
@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly customers: CustomersService,
    @Inject(ASAAS_CLIENT) private readonly asaas: AsaasClient,
  ) {}

  /** Passo 2 do design (RECURRING): rascunho local, sem `asaas_subscription_id` até o Asaas aceitar. */
  createDraft(
    customerId: string,
    plan: ChargePlan,
    calc: PlanCalculation,
    ctx: { contractId?: string; idempotencyKey?: string },
  ) {
    return this.prisma.subscription.create({
      data: {
        customerId,
        contractId: ctx.contractId ?? null,
        status: 'INACTIVE',
        billingType: plan.billingType,
        valueCents: calc.totalCents,
        cycle: plan.cycle!,
        nextDueDate: fromDateOnly(calc.firstDueDate),
        endDate: plan.endDate ? fromDateOnly(plan.endDate) : null,
        description: calc.description,
        finePct: plan.finePct,
        interestPct: plan.interestPct,
        externalReference: ctx.idempotencyKey ?? `rec_${randomUUID()}`,
        items: {
          create: plan.items.map((i) => ({
            serviceId: i.serviceId ?? null,
            description: i.description,
            quantity: i.quantity,
            unitPriceCents: i.unitPriceCents,
            totalCents: i.quantity * i.unitPriceCents,
          })),
        },
      },
    });
  }

  /**
   * Passos 3–5 (RECURRING): cria no Asaas sem duplicar (busca por `externalReference`) e importa as
   * cobranças já geradas. Falha do Asaas: grava `last_error` e devolve o erro.
   */
  async push(subscriptionId: string, opts: { userId?: string; dueDate?: string } = {}): Promise<AsaasError | null> {
    const outcome = await this.prisma.$transaction(
      async (tx): Promise<AsaasError | string> => {
        await tx.$queryRaw`SELECT id FROM subscriptions WHERE id = ${subscriptionId}::uuid FOR UPDATE`;
        const sub = await tx.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
        if (sub.asaasSubscriptionId) return sub.asaasSubscriptionId;

        let remote;
        try {
          const customer = await this.customers.ensureAsaasCustomer(sub.customerId);
          const found = await this.asaas.listSubscriptions({ externalReference: sub.externalReference });
          remote = found.data.find((s) => !s.deleted);
          if (!remote) {
            const nextDueDate = opts.dueDate ?? toDateOnly(sub.nextDueDate);
            if (nextDueDate < todayInSaoPaulo()) throw retryDueDateInPast();
            remote = await this.asaas.createSubscription({
              customer,
              billingType: sub.billingType,
              valueCents: sub.valueCents,
              nextDueDate,
              cycle: sub.cycle,
              endDate: sub.endDate ? toDateOnly(sub.endDate) : null,
              description: sub.description,
              externalReference: sub.externalReference,
              finePct: sub.finePct.toNumber(),
              interestPct: sub.interestPct.toNumber(),
            });
          }
        } catch (error) {
          if (error instanceof AsaasError) return error;
          throw error;
        }

        await tx.subscription.update({
          where: { id: subscriptionId },
          data: { asaasSubscriptionId: remote.id, status: 'ACTIVE', lastError: null },
        });
        await this.audit.record(
          {
            userId: opts.userId,
            action: 'subscription.create',
            entity: 'subscription',
            entityId: subscriptionId,
            data: { valueCents: sub.valueCents, cycle: sub.cycle, asaasSubscriptionId: remote.id },
          },
          tx,
        );
        return remote.id;
      },
      { timeout: 120_000, maxWait: 30_000 },
    );

    if (outcome instanceof AsaasError) {
      await this.prisma.subscription.update({ where: { id: subscriptionId }, data: { lastError: outcome.message } });
      return outcome;
    }
    await this.importCharges(outcome);
    return null;
  }

  /** COB-04.2: cobranças que o Asaas já gerou para a assinatura (o webhook pode importar as mesmas). */
  private async importCharges(asaasSubscriptionId: string) {
    const page = await this.asaas.listPayments({ subscription: asaasSubscriptionId, limit: 100 });
    for (const p of page.data) {
      await importSubscriptionPayment(this.prisma, {
        id: p.id,
        subscription: asaasSubscriptionId,
        status: p.status,
        billingType: p.billingType,
        valueCents: p.valueCents,
        netValueCents: p.netValueCents,
        dueDate: p.dueDate,
        paymentDate: p.paymentDate,
        invoiceUrl: p.invoiceUrl,
        bankSlipUrl: p.bankSlipUrl,
        deleted: p.deleted,
      });
    }
  }

  async chargeIds(subscriptionId: string): Promise<string[]> {
    const rows = await this.prisma.charge.findMany({
      where: { subscriptionId },
      orderBy: { dueDate: 'asc' },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  async list(q: SubscriptionListQuery): Promise<Paginated<SubscriptionListItemDto>> {
    const where: Prisma.SubscriptionWhereInput = { status: q.status, customerId: q.customerId };
    const [rows, total] = await Promise.all([
      this.prisma.subscription.findMany({
        where,
        include: listInclude,
        orderBy: [{ status: 'asc' }, { nextDueDate: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.subscription.count({ where }),
    ]);
    return { data: rows.map(toSubscriptionListItemDto), meta: { page: q.page, pageSize: q.pageSize, total } };
  }

  async get(id: string): Promise<SubscriptionDetailDto> {
    const row = await this.prisma.subscription.findUnique({ where: { id }, include: { ...listInclude, items: true } });
    if (!row) throw subscriptionNotFound();
    const charges = await this.prisma.charge.findMany({
      where: { subscriptionId: id },
      include: chargeListInclude,
      orderBy: { dueDate: 'desc' },
    });
    return toSubscriptionDetailDto(row, charges);
  }

  /** Recorrência que não chegou ao Asaas: "Tentar de novo". */
  async retry(id: string, userId: string): Promise<SubscriptionDetailDto> {
    const sub = await this.prisma.subscription.findUnique({ where: { id } });
    if (!sub) throw subscriptionNotFound();
    if (sub.asaasSubscriptionId) throw subscriptionAlreadySent();
    if (sub.status === 'CANCELED') throw subscriptionNotCancelable();
    await this.push(id, { userId });
    return this.get(id);
  }

  /**
   * COB-11.1: remove no Asaas e marca CANCELED. O Asaas apaga junto as cobranças em aberto; as que
   * sumiram da assinatura viram CANCELED aqui (resposta da nossa chamada), o webhook confirma depois.
   */
  async cancel(id: string, userId: string): Promise<SubscriptionDetailDto> {
    const sub = await this.prisma.subscription.findUnique({ where: { id } });
    if (!sub) throw subscriptionNotFound();
    if (sub.status === 'CANCELED') throw subscriptionNotCancelable();

    let remaining: Set<string> | null = null;
    if (sub.asaasSubscriptionId) {
      await this.asaas.deleteSubscription(sub.asaasSubscriptionId);
      const page = await this.asaas.listPayments({ subscription: sub.asaasSubscriptionId, limit: 100 });
      remaining = new Set(page.data.filter((p) => !p.deleted).map((p) => p.id));
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.subscription.update({ where: { id }, data: { status: 'CANCELED' } });
      if (remaining) {
        await tx.charge.updateMany({
          where: {
            subscriptionId: id,
            status: { in: ['PENDING', 'OVERDUE'] },
            asaasPaymentId: { notIn: [...remaining] },
          },
          data: { status: 'CANCELED' },
        });
      }
      await this.audit.record({ userId, action: 'subscription.cancel', entity: 'subscription', entityId: id }, tx);
    });
    return this.get(id);
  }
}
