import { randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  calculatePlan,
  todayInSaoPaulo,
  type AsaasRequestPreview,
  type ChargeCancelInput,
  type ChargeCreateRequest,
  type ChargeCreateResponseDto,
  type ChargeDetailDto,
  type ChargeListDto,
  type ChargeListQuery,
  type ChargeOrigin,
  type ChargePlan,
  type ChargePreviewDto,
  type ChargeRefundInput,
  type ChargeStatus,
  type PaymentInfoDto,
  type PlanCalculation,
  type Role,
} from '@financeiro/shared';
import type { Env } from '../../config/env.schema';
import type { JwtPayload } from '../../common/decorators/current-user.decorator';
import { DomainException } from '../../common/filters/domain-exception.filter';
import {
  ASAAS_CLIENT,
  asaasPaymentBody,
  asaasSubscriptionBody,
  type AsaasClient,
  type AsaasPayment,
} from '../../integrations/asaas/asaas.client';
import { AsaasError } from '../../integrations/asaas/http-asaas.client';
import type { Charge, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CustomersService } from '../customers/customers.service';
import { customerNotFound } from '../customers/customers.errors';
import { toDateOnly } from '../customers/customers.mapper';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import {
  asaasCreateFailed,
  chargeNotCancelable,
  chargeNotDraft,
  chargeNotFound,
  chargeNotRefundable,
  customerArchived,
  planError,
  refundExceedsValue,
  retryDueDateInPast,
} from './charges.errors';
import { fromDateOnly, statusFromAsaas, toChargeDetailDto, toChargeListItemDto } from './charges.mapper';

export interface CreateFromPlanContext {
  origin: Extract<ChargeOrigin, 'MANUAL' | 'CONTRACT'>;
  contractId?: string;
  userId?: string;
  /** Regra de vencimento DAYS_AFTER_SIGNATURE (contratos). */
  signedAt?: Date;
  /** Substitui o `externalReference`/`group_key` gerado: chamadas repetidas reaproveitam os mesmos registros (contratos). */
  idempotencyKey?: string;
}

export interface CreatedFromPlan {
  chargeIds: string[];
  subscriptionId?: string;
}

const OPEN_STATUSES: ChargeStatus[] = ['PENDING', 'OVERDUE'];
const REFUNDABLE: ChargeStatus[] = ['PAID', 'CONFIRMED', 'PARTIALLY_REFUNDED'];
const PIX_BILLING = new Set(['PIX', 'UNDEFINED']);
const BOLETO_BILLING = new Set(['BOLETO', 'UNDEFINED']);
const listInclude = {
  customer: { select: { id: true, name: true } },
  subscription: { select: { cycle: true } },
} as const;

@Injectable()
export class ChargesService {
  private readonly logger = new Logger(ChargesService.name);
  private readonly minChargeCents: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly customers: CustomersService,
    private readonly subscriptions: SubscriptionsService,
    @Inject(ASAAS_CLIENT) private readonly asaas: AsaasClient,
    config: ConfigService<Env, true>,
  ) {
    this.minChargeCents = config.get('ASAAS_MIN_CHARGE_CENTS', { infer: true });
  }

  /** COB-01.4: sem efeitos colaterais (nada no banco nem no Asaas). */
  async preview({ customerId, plan }: ChargeCreateRequest): Promise<ChargePreviewDto> {
    const customer = await this.loadCustomerForNewCharge(customerId);
    const calc = this.calculate(plan);

    const asaasRequests: AsaasRequestPreview[] = customer.asaasCustomerId
      ? []
      : [
          { method: 'GET', path: `/customers?cpfCnpj=${customer.document}` },
          { method: 'POST', path: '/customers' },
        ];
    const common = {
      customer: customer.asaasCustomerId ?? '(criado ao gerar)',
      billingType: plan.billingType,
      description: calc.description,
      externalReference: '(gerado ao gerar)',
      finePct: plan.finePct,
      interestPct: plan.interestPct,
    };
    if (plan.type === 'RECURRING') {
      asaasRequests.push({
        method: 'POST',
        path: '/subscriptions',
        body: asaasSubscriptionBody({
          ...common,
          valueCents: calc.totalCents,
          nextDueDate: calc.firstDueDate,
          cycle: plan.cycle!,
          endDate: plan.endDate ?? null,
        }),
      });
    } else {
      asaasRequests.push({
        method: 'POST',
        path: '/payments',
        body: asaasPaymentBody({
          ...common,
          valueCents: calc.totalCents,
          dueDate: calc.firstDueDate,
          ...(plan.type === 'INSTALLMENT' && {
            installmentCount: calc.installments.length,
            totalValueCents: calc.totalCents,
          }),
        }),
      });
    }
    return { ...calc, asaasRequests, customerWillBeCreated: !customer.asaasCustomerId };
  }

  async create(input: ChargeCreateRequest, actor: JwtPayload): Promise<ChargeCreateResponseDto> {
    const created = await this.createFromPlanDetailed(input.customerId, input.plan, { origin: 'MANUAL', userId: actor.sub });
    const charges = await Promise.all(created.chargeIds.map((id) => this.get(id, actor.role)));
    if (!created.subscriptionId) return { charges };
    const { charges: _, ...subscription } = await this.subscriptions.get(created.subscriptionId);
    return { charges, subscription };
  }

  /** Caminho único de criação (Nova Cobrança e contratos): ids das cobranças locais. */
  async createFromPlan(customerId: string, plan: ChargePlan, ctx: CreateFromPlanContext): Promise<string[]> {
    return (await this.createFromPlanDetailed(customerId, plan, ctx)).chargeIds;
  }

  /**
   * Rascunho local → Asaas → espelho. Falha no Asaas: rascunho fica em DRAFT (ou a recorrência sem
   * `asaas_subscription_id`) e o erro ASAAS_* traz `chargeIds`/`subscriptionId`.
   */
  async createFromPlanDetailed(customerId: string, plan: ChargePlan, ctx: CreateFromPlanContext): Promise<CreatedFromPlan> {
    if (plan.type === 'RECURRING') return this.createRecurring(customerId, plan, ctx);

    const key = ctx.idempotencyKey;
    const existing = key
      ? await this.prisma.charge.findMany({
          where: plan.type === 'SINGLE' ? { externalReference: key } : { groupKey: key },
          orderBy: { installmentNumber: 'asc' },
        })
      : [];
    if (existing.length && existing.every((c) => c.status !== 'DRAFT')) return { chargeIds: existing.map((c) => c.id) };

    await this.loadCustomerForNewCharge(customerId);
    const calc = this.calculate(plan, ctx.signedAt);
    const drafts = existing.length ? existing : await this.createDrafts(customerId, plan, calc, ctx);
    const ids = drafts.map((d) => d.id);
    // Rascunho reaproveitado recebe o vencimento do plano atual (CTR-05.2) se ainda não existir no Asaas.
    const failure = drafts[0]!.groupKey
      ? await this.pushGroup(drafts[0]!.groupKey, { userId: ctx.userId, dueDate: calc.firstDueDate })
      : await this.push(ids[0]!, { userId: ctx.userId, dueDate: calc.firstDueDate });
    if (failure) throw asaasCreateFailed(failure, ids);
    return { chargeIds: ids };
  }

  private async createRecurring(customerId: string, plan: ChargePlan, ctx: CreateFromPlanContext): Promise<CreatedFromPlan> {
    const existing = ctx.idempotencyKey
      ? await this.prisma.subscription.findUnique({ where: { externalReference: ctx.idempotencyKey } })
      : null;
    if (existing?.asaasSubscriptionId) {
      return { chargeIds: await this.subscriptions.chargeIds(existing.id), subscriptionId: existing.id };
    }

    await this.loadCustomerForNewCharge(customerId);
    const calc = this.calculate(plan, ctx.signedAt);
    const sub = existing ?? (await this.subscriptions.createDraft(customerId, plan, calc, ctx));
    const failure = await this.subscriptions.push(sub.id, { userId: ctx.userId, dueDate: calc.firstDueDate });
    if (failure) {
      throw new DomainException(failure.code, failure.message, failure.httpStatus, { chargeIds: [], subscriptionId: sub.id });
    }
    return { chargeIds: await this.subscriptions.chargeIds(sub.id), subscriptionId: sub.id };
  }

  /**
   * COB-12.2/COB-12.3: reenvia ao Asaas sem duplicar (o parcelamento inteiro, se for parcela). Nova falha
   * do Asaas não é erro HTTP: volta o rascunho (DRAFT) com `lastError`.
   */
  async retry(id: string, actor: JwtPayload): Promise<ChargeDetailDto> {
    const charge = await this.prisma.charge.findUnique({ where: { id }, select: { status: true, groupKey: true } });
    if (!charge) throw chargeNotFound();
    if (charge.status !== 'DRAFT') throw chargeNotDraft();
    if (charge.groupKey) await this.pushGroup(charge.groupKey, { userId: actor.sub });
    else await this.push(id, { userId: actor.sub });
    return this.get(id, actor.role);
  }

  /** COB-12.1: descarte só local (parcelamento: todas as parcelas em rascunho). */
  async discard(id: string, actor: JwtPayload): Promise<ChargeDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const charge = await tx.charge.findUnique({ where: { id }, select: { status: true, groupKey: true } });
      if (!charge) throw chargeNotFound();
      if (charge.status !== 'DRAFT') throw chargeNotDraft();
      await tx.charge.updateMany({
        where: charge.groupKey ? { groupKey: charge.groupKey, status: 'DRAFT' } : { id, status: 'DRAFT' },
        data: { status: 'CANCELED' },
      });
      await this.audit.record({ userId: actor.sub, action: 'charge.discard', entity: 'charge', entityId: id }, tx);
    });
    return this.get(id, actor.role);
  }

  /** COB-07.1 */
  async get(id: string, role: Role): Promise<ChargeDetailDto> {
    const row = await this.prisma.charge.findUnique({ where: { id }, include: { customer: true, items: true } });
    if (!row) throw chargeNotFound();
    const [events, installments, subscription] = await Promise.all([
      row.asaasPaymentId
        ? this.prisma.webhookEvent.findMany({
            where: { source: { in: ['ASAAS', 'RECONCILE'] }, resourceId: row.asaasPaymentId },
            orderBy: { receivedAt: 'desc' },
            select: { id: true, event: true, receivedAt: true, processedAt: true, result: true },
          })
        : [],
      row.groupKey
        ? this.prisma.charge.findMany({
            where: { groupKey: row.groupKey },
            include: listInclude,
            orderBy: { installmentNumber: 'asc' },
          })
        : [],
      row.subscriptionId
        ? this.prisma.subscription.findUnique({ where: { id: row.subscriptionId }, include: { customer: { select: { id: true, name: true } } } })
        : null,
    ]);
    return toChargeDetailDto(row, events, role, { installments, subscription });
  }

  /** COB-06: filtros, contagem por status (sem o filtro de status) e soma. */
  async list(q: ChargeListQuery): Promise<ChargeListDto> {
    const search = q.search?.trim();
    const base: Prisma.ChargeWhereInput = {
      customerId: q.customerId,
      type: q.type,
      billingType: q.billingType,
      dueDate: q.dueFrom || q.dueTo ? { gte: q.dueFrom && fromDateOnly(q.dueFrom), lte: q.dueTo && fromDateOnly(q.dueTo) } : undefined,
      ...(search && {
        OR: [
          { customer: { name: { contains: search, mode: 'insensitive' } } },
          { asaasPaymentId: { startsWith: search } },
          { description: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };
    const where: Prisma.ChargeWhereInput = { ...base, status: q.status?.length ? { in: q.status } : undefined };
    const [field, dir] = q.sort.split(':') as ['dueDate' | 'value', 'asc' | 'desc'];
    const orderBy: Prisma.ChargeOrderByWithRelationInput[] = [
      field === 'value' ? { valueCents: dir } : { dueDate: dir },
      { installmentNumber: 'asc' },
      { createdAt: 'desc' },
    ];

    const [rows, total, byStatus, sum] = await Promise.all([
      this.prisma.charge.findMany({ where, include: listInclude, orderBy, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.charge.count({ where }),
      this.prisma.charge.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
      this.prisma.charge.aggregate({ where, _sum: { valueCents: true } }),
    ]);
    return {
      data: rows.map(toChargeListItemDto),
      meta: { page: q.page, pageSize: q.pageSize, total },
      summary: {
        countByStatus: Object.fromEntries(byStatus.map((g) => [g.status, g._count._all])),
        totalCents: sum._sum.valueCents ?? 0,
      },
    };
  }

  /**
   * COB-08: remove no Asaas e marca CANCELED (o webhook PAYMENT_DELETED depois é idempotente).
   * Parcelas restantes: em sequência, parando no primeiro erro e dizendo quantas foram canceladas.
   */
  async cancel(id: string, { scope }: ChargeCancelInput, actor: JwtPayload): Promise<ChargeDetailDto[]> {
    const charge = await this.prisma.charge.findUnique({ where: { id } });
    if (!charge) throw chargeNotFound();
    const targets =
      scope === 'REMAINING_INSTALLMENTS' && charge.groupKey
        ? await this.prisma.charge.findMany({
            where: { groupKey: charge.groupKey, status: { in: OPEN_STATUSES } },
            orderBy: { installmentNumber: 'asc' },
          })
        : OPEN_STATUSES.includes(charge.status)
          ? [charge]
          : [];
    if (targets.length === 0) throw chargeNotCancelable();

    const canceled: string[] = [];
    for (const target of targets) {
      try {
        if (target.asaasPaymentId) await this.asaas.deletePayment(target.asaasPaymentId);
      } catch (error) {
        // Já removida no Asaas: segue e espelha.
        if (!(error instanceof AsaasError && error.asaasCode === 'ASAAS_NOT_FOUND')) {
          if (canceled.length === 0) throw error;
          const e = error as DomainException;
          throw new DomainException(
            e.code,
            `${canceled.length} parcela(s) cancelada(s); a seguinte falhou: ${e.message}`,
            e.httpStatus ?? HttpStatus.BAD_GATEWAY,
            { canceled },
          );
        }
      }
      await this.prisma.$transaction(async (tx) => {
        await tx.charge.updateMany({ where: { id: target.id, status: { in: OPEN_STATUSES } }, data: { status: 'CANCELED' } });
        await this.audit.record(
          {
            userId: actor.sub,
            action: 'charge.cancel',
            entity: 'charge',
            entityId: target.id,
            data: { valueCents: target.valueCents, scope },
          },
          tx,
        );
      });
      canceled.push(target.id);
    }
    return Promise.all(canceled.map((cid) => this.get(cid, actor.role)));
  }

  /** COB-09: pede o estorno ao Asaas; o status muda só pelo webhook. */
  async refund(id: string, input: ChargeRefundInput, actor: JwtPayload): Promise<ChargeDetailDto> {
    const charge = await this.prisma.charge.findUnique({ where: { id } });
    if (!charge) throw chargeNotFound();
    if (!REFUNDABLE.includes(charge.status) || !charge.asaasPaymentId) throw chargeNotRefundable();
    const balance = charge.valueCents - charge.refundedCents;
    const value = input.valueCents ?? balance;
    if (value > balance) throw refundExceedsValue(balance);

    await this.asaas.refundPayment(charge.asaasPaymentId, value, input.description);
    await this.prisma.$transaction(async (tx) => {
      await tx.charge.update({ where: { id }, data: { refundRequestedAt: new Date() } });
      await this.audit.record(
        { userId: actor.sub, action: 'charge.refund', entity: 'charge', entityId: id, data: { valueCents: value } },
        tx,
      );
    });
    return this.get(id, actor.role);
  }

  /** COB-05: para cobrança em aberto, busca no Asaas o que faltar e grava. */
  async paymentInfo(id: string): Promise<PaymentInfoDto> {
    let charge = await this.prisma.charge.findUnique({ where: { id } });
    if (!charge) throw chargeNotFound();
    let pixQrCodeBase64: string | null = null;
    if (charge.asaasPaymentId && OPEN_STATUSES.includes(charge.status)) {
      ({ charge, pixQrCodeBase64 } = await this.completePaymentData(charge, true));
    }
    return {
      invoiceUrl: charge.invoiceUrl,
      bankSlipUrl: charge.bankSlipUrl,
      pixPayload: charge.pixPayload,
      pixQrCodeBase64,
      identificationField: charge.identificationField,
    };
  }

  private async loadCustomerForNewCharge(customerId: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw customerNotFound();
    if (customer.archivedAt) throw customerArchived();
    return customer;
  }

  private calculate(plan: ChargePlan, signedAt?: Date): PlanCalculation {
    const result = calculatePlan(plan, { today: todayInSaoPaulo(), signedAt, minChargeCents: this.minChargeCents });
    if (!result.ok) throw planError(result.error);
    return result.value;
  }

  /** COB-02.4/COB-03: itens com descrição e preço congelados (replicados em cada parcela). */
  private async createDrafts(customerId: string, plan: ChargePlan, calc: PlanCalculation, ctx: CreateFromPlanContext) {
    const installment = plan.type === 'INSTALLMENT';
    const groupKey = installment ? (ctx.idempotencyKey ?? `grp_${randomUUID()}`) : null;
    const items = plan.items.map((i) => ({
      serviceId: i.serviceId ?? null,
      description: i.description,
      quantity: i.quantity,
      unitPriceCents: i.unitPriceCents,
      totalCents: i.quantity * i.unitPriceCents,
    }));
    return this.prisma.$transaction(
      calc.installments.map((parcel) => {
        const id = randomUUID();
        return this.prisma.charge.create({
          data: {
            id,
            customerId,
            contractId: ctx.contractId ?? null,
            origin: ctx.origin,
            type: plan.type,
            billingType: plan.billingType,
            valueCents: parcel.valueCents,
            discountCents: calc.discountCents,
            finePct: plan.finePct,
            interestPct: plan.interestPct,
            dueDate: fromDateOnly(parcel.dueDate),
            description: calc.description,
            installmentNumber: installment ? parcel.number : null,
            installmentCount: installment ? calc.installments.length : null,
            groupKey,
            externalReference: groupKey ? `${groupKey}:${parcel.number}` : (ctx.idempotencyKey ?? `chg_${id}`),
            createdById: ctx.userId ?? null,
            items: { create: items },
          },
        });
      }),
    );
  }

  /**
   * Passos 3–7 do design (avulsa): cliente no Asaas → busca por externalReference → cria → espelho → auditoria.
   * Falha do Asaas: grava `last_error`, mantém DRAFT e devolve o erro.
   */
  private async push(chargeId: string, opts: { userId?: string; dueDate?: string }): Promise<AsaasError | null> {
    const outcome = await this.prisma.$transaction(
      async (tx): Promise<'PUSHED' | 'SKIPPED' | AsaasError> => {
        // Trava a linha: dois "Tentar de novo" simultâneos não criam duas cobranças, e o webhook
        // que chegar antes do espelho espera o commit.
        await tx.$queryRaw`SELECT id FROM charges WHERE id = ${chargeId}::uuid FOR UPDATE`;
        const charge = await tx.charge.findUniqueOrThrow({ where: { id: chargeId } });
        if (charge.status !== 'DRAFT') return 'SKIPPED';

        let payment;
        try {
          const customer = await this.customers.ensureAsaasCustomer(charge.customerId);
          const found = await this.asaas.listPayments({ externalReference: charge.externalReference });
          payment = found.data.find((p) => !p.deleted);
          if (!payment) {
            const dueDate = opts.dueDate ?? toDateOnly(charge.dueDate);
            if (dueDate < todayInSaoPaulo()) throw retryDueDateInPast();
            payment = await this.asaas.createPayment({
              customer,
              billingType: charge.billingType,
              valueCents: charge.valueCents,
              dueDate,
              description: charge.description,
              externalReference: charge.externalReference,
              finePct: charge.finePct.toNumber(),
              interestPct: charge.interestPct.toNumber(),
            });
          }
        } catch (error) {
          if (error instanceof AsaasError) return error;
          throw error;
        }

        await tx.charge.update({ where: { id: chargeId }, data: mirrorOf(payment) });
        await this.audit.record(
          {
            userId: opts.userId,
            action: 'charge.create',
            entity: 'charge',
            entityId: chargeId,
            data: {
              type: charge.type,
              origin: charge.origin,
              valueCents: charge.valueCents,
              externalReference: charge.externalReference,
              asaasPaymentId: payment.id,
            },
          },
          tx,
        );
        return 'PUSHED';
      },
      // As chamadas ao Asaas acontecem dentro da transação (timeout de 15 s por requisição).
      { timeout: 120_000, maxWait: 30_000 },
    );

    if (outcome instanceof AsaasError) {
      await this.prisma.charge.update({ where: { id: chargeId }, data: { lastError: outcome.message } });
      return outcome;
    }
    if (outcome === 'PUSHED') {
      await this.completePaymentData(await this.prisma.charge.findUniqueOrThrow({ where: { id: chargeId } }), false);
    }
    return null;
  }

  /**
   * COB-03 (passo 4, INSTALLMENT): um parcelamento no Asaas para o grupo; casa as parcelas por
   * `installmentNumber` (senão pela ordem de vencimento). Valores e datas do Asaas vencem.
   */
  private async pushGroup(groupKey: string, opts: { userId?: string; dueDate?: string }): Promise<AsaasError | null> {
    const outcome = await this.prisma.$transaction(
      async (tx): Promise<'PUSHED' | 'SKIPPED' | AsaasError> => {
        await tx.$queryRaw`SELECT id FROM charges WHERE group_key = ${groupKey} ORDER BY installment_number FOR UPDATE`;
        const charges = await tx.charge.findMany({ where: { groupKey }, orderBy: { installmentNumber: 'asc' } });
        if (!charges.some((c) => c.status === 'DRAFT')) return 'SKIPPED';
        const first = charges[0]!;
        const totalCents = charges.reduce((sum, c) => sum + c.valueCents, 0);

        let payments: AsaasPayment[];
        let installmentId: string | null | undefined;
        try {
          const customer = await this.customers.ensureAsaasCustomer(first.customerId);
          const found = await this.asaas.listPayments({ externalReference: groupKey });
          installmentId = found.data.find((p) => !p.deleted && p.installment)?.installment;
          if (!installmentId) {
            const dueDate = opts.dueDate ?? toDateOnly(first.dueDate);
            if (dueDate < todayInSaoPaulo()) throw retryDueDateInPast();
            const created = await this.asaas.createPayment({
              customer,
              billingType: first.billingType,
              valueCents: totalCents,
              totalValueCents: totalCents,
              installmentCount: charges.length,
              dueDate,
              description: first.description,
              externalReference: groupKey,
              finePct: first.finePct.toNumber(),
              interestPct: first.interestPct.toNumber(),
            });
            installmentId = created.installment;
            if (!installmentId) throw new AsaasError('ASAAS_UNEXPECTED', false);
          }
          payments = (await this.asaas.listPayments({ installment: installmentId, limit: 100 })).data
            .filter((p) => !p.deleted)
            .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
        } catch (error) {
          if (error instanceof AsaasError) return error;
          throw error;
        }

        for (const [index, charge] of charges.entries()) {
          const payment = payments.find((p) => p.installmentNumber === charge.installmentNumber) ?? payments[index];
          if (!payment) continue;
          await tx.charge.update({
            where: { id: charge.id },
            data: { ...mirrorOf(payment), valueCents: payment.valueCents, asaasInstallmentId: installmentId },
          });
        }
        await this.audit.record(
          {
            userId: opts.userId,
            action: 'charge.create',
            entity: 'charge',
            entityId: first.id,
            data: { type: 'INSTALLMENT', origin: first.origin, valueCents: totalCents, groupKey, installments: charges.length, asaasInstallmentId: installmentId },
          },
          tx,
        );
        return 'PUSHED';
      },
      { timeout: 120_000, maxWait: 30_000 },
    );

    if (outcome instanceof AsaasError) {
      await this.prisma.charge.updateMany({ where: { groupKey, status: 'DRAFT' }, data: { lastError: outcome.message } });
      return outcome;
    }
    if (outcome === 'PUSHED') {
      for (const charge of await this.prisma.charge.findMany({ where: { groupKey } })) {
        if (charge.asaasPaymentId) await this.completePaymentData(charge, false);
      }
    }
    return null;
  }

  /** COB-05.2: Pix copia-e-cola e linha digitável sem bloquear: falha só gera log. */
  private async completePaymentData(charge: Charge, withQrCode: boolean) {
    const paymentId = charge.asaasPaymentId!;
    const [pix, line, payment] = await Promise.allSettled([
      PIX_BILLING.has(charge.billingType) && (withQrCode || !charge.pixPayload)
        ? this.asaas.getPixQrCode(paymentId)
        : null,
      BOLETO_BILLING.has(charge.billingType) && !charge.identificationField
        ? this.asaas.getIdentificationField(paymentId)
        : null,
      charge.invoiceUrl ? null : this.asaas.getPayment(paymentId),
    ]);

    const data: Prisma.ChargeUpdateInput = {};
    if (pix.status === 'fulfilled' && pix.value && !charge.pixPayload) data.pixPayload = pix.value.payload;
    if (line.status === 'fulfilled' && line.value) data.identificationField = line.value.identificationField;
    if (payment.status === 'fulfilled' && payment.value) {
      data.invoiceUrl = payment.value.invoiceUrl;
      data.bankSlipUrl = payment.value.bankSlipUrl;
    }
    if ([pix, line, payment].some((r) => r.status === 'rejected')) {
      this.logger.warn(`Dados de pagamento incompletos para a cobrança ${charge.id}`);
    }

    const updated = Object.keys(data).length
      ? await this.prisma.charge.update({ where: { id: charge.id }, data })
      : charge;
    const pixQrCodeBase64 = pix.status === 'fulfilled' ? (pix.value?.encodedImage ?? null) : null;
    return { charge: updated, pixQrCodeBase64 };
  }
}

/** Espelho do que o Asaas devolveu ao criar (passo 5). */
function mirrorOf(payment: AsaasPayment): Prisma.ChargeUpdateInput {
  return {
    status: statusFromAsaas(payment.status),
    asaasPaymentId: payment.id,
    invoiceUrl: payment.invoiceUrl,
    bankSlipUrl: payment.bankSlipUrl,
    dueDate: fromDateOnly(payment.dueDate),
    paidAt: payment.paymentDate ? fromDateOnly(payment.paymentDate) : null,
    lastError: null,
  };
}
