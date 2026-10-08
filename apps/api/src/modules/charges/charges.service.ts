import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  calculatePlan,
  todayInSaoPaulo,
  type AsaasRequestPreview,
  type ChargeCreateRequest,
  type ChargeCreateResponseDto,
  type ChargeDetailDto,
  type ChargeOrigin,
  type ChargePlan,
  type ChargePreviewDto,
  type ChargeStatus,
  type PaymentInfoDto,
  type PlanCalculation,
  type Role,
} from '@financeiro/shared';
import type { Env } from '../../config/env.schema';
import type { JwtPayload } from '../../common/decorators/current-user.decorator';
import { ASAAS_CLIENT, asaasPaymentBody, type AsaasClient } from '../../integrations/asaas/asaas.client';
import { AsaasError } from '../../integrations/asaas/http-asaas.client';
import type { Charge, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CustomersService } from '../customers/customers.service';
import { customerNotFound } from '../customers/customers.errors';
import { toDateOnly } from '../customers/customers.mapper';
import {
  asaasCreateFailed,
  chargeNotDraft,
  chargeNotFound,
  chargeTypeNotAvailable,
  customerArchived,
  planError,
  retryDueDateInPast,
} from './charges.errors';
import { fromDateOnly, statusFromAsaas, toChargeDetailDto } from './charges.mapper';

export interface CreateFromPlanContext {
  origin: Extract<ChargeOrigin, 'MANUAL' | 'CONTRACT'>;
  contractId?: string;
  userId?: string;
  /** Regra de vencimento DAYS_AFTER_SIGNATURE (contratos). */
  signedAt?: Date;
  /** Substitui o `externalReference` gerado: chamadas repetidas reaproveitam o mesmo registro (contratos). */
  idempotencyKey?: string;
}

const OPEN_STATUSES: ChargeStatus[] = ['PENDING', 'OVERDUE'];
const PIX_BILLING = new Set(['PIX', 'UNDEFINED']);
const BOLETO_BILLING = new Set(['BOLETO', 'UNDEFINED']);

@Injectable()
export class ChargesService {
  private readonly logger = new Logger(ChargesService.name);
  private readonly minChargeCents: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly customers: CustomersService,
    @Inject(ASAAS_CLIENT) private readonly asaas: AsaasClient,
    config: ConfigService<Env, true>,
  ) {
    this.minChargeCents = config.get('ASAAS_MIN_CHARGE_CENTS', { infer: true });
  }

  /** COB-01.4: sem efeitos colaterais (nada no banco nem no Asaas). */
  async preview({ customerId, plan }: ChargeCreateRequest): Promise<ChargePreviewDto> {
    const customer = await this.loadCustomerForNewCharge(customerId);
    if (plan.type !== 'SINGLE') throw chargeTypeNotAvailable();
    const calc = this.calculate(plan);

    const asaasRequests: AsaasRequestPreview[] = customer.asaasCustomerId
      ? []
      : [
          { method: 'GET', path: `/customers?cpfCnpj=${customer.document}` },
          { method: 'POST', path: '/customers' },
        ];
    asaasRequests.push({
      method: 'POST',
      path: '/payments',
      body: asaasPaymentBody({
        customer: customer.asaasCustomerId ?? '(criado ao gerar)',
        billingType: plan.billingType,
        valueCents: calc.totalCents,
        dueDate: calc.firstDueDate,
        description: calc.description,
        externalReference: '(gerado ao gerar)',
        finePct: plan.finePct,
        interestPct: plan.interestPct,
      }),
    });
    return { ...calc, asaasRequests, customerWillBeCreated: !customer.asaasCustomerId };
  }

  async create(input: ChargeCreateRequest, actor: JwtPayload): Promise<ChargeCreateResponseDto> {
    const ids = await this.createFromPlan(input.customerId, input.plan, { origin: 'MANUAL', userId: actor.sub });
    return { charges: await Promise.all(ids.map((id) => this.get(id, actor.role))) };
  }

  /**
   * Caminho único de criação (Nova Cobrança e contratos). Rascunho local → Asaas → espelho.
   * Devolve os ids locais. Falha no Asaas: rascunho fica em DRAFT e o erro ASAAS_* traz `chargeIds`.
   */
  async createFromPlan(customerId: string, plan: ChargePlan, ctx: CreateFromPlanContext): Promise<string[]> {
    if (plan.type !== 'SINGLE') throw chargeTypeNotAvailable();

    const existing = ctx.idempotencyKey
      ? await this.prisma.charge.findUnique({ where: { externalReference: ctx.idempotencyKey } })
      : null;
    if (existing && existing.status !== 'DRAFT') return [existing.id];

    await this.loadCustomerForNewCharge(customerId);
    const calc = this.calculate(plan, ctx.signedAt);
    const draft = existing ?? (await this.createDraft(customerId, plan, calc, ctx));
    // Rascunho reaproveitado recebe o vencimento do plano atual (CTR-05.2) se ainda não existir no Asaas.
    const failure = await this.push(draft.id, { userId: ctx.userId, dueDate: calc.firstDueDate });
    if (failure) throw asaasCreateFailed(failure, [draft.id]);
    return [draft.id];
  }

  /**
   * COB-12.2/COB-12.3: reenvia ao Asaas sem duplicar. Nova falha do Asaas não é erro HTTP: volta o
   * rascunho (DRAFT) com `lastError` para a tela oferecer de novo "Tentar de novo"/"Descartar".
   */
  async retry(id: string, actor: JwtPayload): Promise<ChargeDetailDto> {
    const charge = await this.prisma.charge.findUnique({ where: { id }, select: { status: true } });
    if (!charge) throw chargeNotFound();
    if (charge.status !== 'DRAFT') throw chargeNotDraft();
    await this.push(id, { userId: actor.sub });
    return this.get(id, actor.role);
  }

  /** COB-12.1: descarte só local. */
  async discard(id: string, actor: JwtPayload): Promise<ChargeDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.charge.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'CANCELED' } });
      if (count === 0) {
        throw (await tx.charge.count({ where: { id } })) ? chargeNotDraft() : chargeNotFound();
      }
      await this.audit.record({ userId: actor.sub, action: 'charge.discard', entity: 'charge', entityId: id }, tx);
    });
    return this.get(id, actor.role);
  }

  /** COB-07.1 */
  async get(id: string, role: Role): Promise<ChargeDetailDto> {
    const row = await this.prisma.charge.findUnique({ where: { id }, include: { customer: true, items: true } });
    if (!row) throw chargeNotFound();
    const events = row.asaasPaymentId
      ? await this.prisma.webhookEvent.findMany({
          where: { source: 'ASAAS', resourceId: row.asaasPaymentId },
          orderBy: { receivedAt: 'desc' },
          select: { id: true, event: true, receivedAt: true, processedAt: true, result: true },
        })
      : [];
    return toChargeDetailDto(row, events, role);
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

  /** COB-02.4: itens com descrição e preço congelados. */
  private createDraft(customerId: string, plan: ChargePlan, calc: PlanCalculation, ctx: CreateFromPlanContext) {
    const id = randomUUID();
    return this.prisma.charge.create({
      data: {
        id,
        customerId,
        contractId: ctx.contractId ?? null,
        origin: ctx.origin,
        type: 'SINGLE',
        billingType: plan.billingType,
        valueCents: calc.totalCents,
        discountCents: calc.discountCents,
        finePct: plan.finePct,
        interestPct: plan.interestPct,
        dueDate: fromDateOnly(calc.firstDueDate),
        description: calc.description,
        externalReference: ctx.idempotencyKey ?? `chg_${id}`,
        createdById: ctx.userId ?? null,
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
   * Passos 3–7 do design: cliente no Asaas → busca por externalReference → cria → espelho → auditoria.
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

        await tx.charge.update({
          where: { id: chargeId },
          data: {
            status: statusFromAsaas(payment.status),
            asaasPaymentId: payment.id,
            invoiceUrl: payment.invoiceUrl,
            bankSlipUrl: payment.bankSlipUrl,
            dueDate: fromDateOnly(payment.dueDate),
            paidAt: payment.paymentDate ? fromDateOnly(payment.paymentDate) : null,
            lastError: null,
          },
        });
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
