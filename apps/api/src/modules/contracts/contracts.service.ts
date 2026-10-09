import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  isAddressComplete,
  resolveContractVariables,
  todayInSaoPaulo,
  type AuthMethod,
  type ChargePlan,
  type ContractDetailDto,
  type ContractDraft,
  type ContractListItemDto,
  type ContractListQuery,
  type ContractPreviewDto,
  type ContractProviderName,
  type ContractUpdateInput,
  type Paginated,
} from '@financeiro/shared';
import type { Env } from '../../config/env.schema';
import type { JwtPayload } from '../../common/decorators/current-user.decorator';
import { DomainException } from '../../common/filters/domain-exception.filter';
import type { Contract, Customer, Prisma } from '../../generated/prisma/client.js';
import {
  CONTRACT_PROVIDER,
  ContractProviderError,
  type ContractProvider,
  type ProviderProgress,
} from '../../integrations/contracts/contract-provider';
import { StorageService } from '../../integrations/storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { requeue } from '../../queues/enqueue';
import { CONTRACT_CHARGE_JOB, CONTRACT_CHARGE_JOB_OPTIONS, CONTRACT_CHARGE_QUEUE, contractChargeJobId } from '../../queues/contracts';
import { AuditService } from '../audit/audit.service';
import { customerArchived } from '../charges/charges.errors';
import { toChargeListItemDto, toSubscriptionListItemDto } from '../charges/charges.mapper';
import { customerNotFound } from '../customers/customers.errors';
import {
  contractChargeAlreadyGenerated,
  contractMissingVariables,
  contractNotCancelable,
  contractNotDraft,
  contractNotFound,
  contractNotSigned,
  customerAddressRequired,
  signedFileMissing,
  signerNotPending,
  templateInactive,
  templateNotFound,
} from './contracts.errors';

const DAY_MS = 86_400_000;
const OPEN_STATUSES = ['SENT', 'PARTIALLY_SIGNED'] as const;
const listInclude = { customer: { select: { id: true, name: true } } } as const;

type ContractListRow = Contract & { customer: Pick<Customer, 'id' | 'name'> };

/** Sem coluna própria: a validade do rascunho vive em `expires_at - created_at` e é refeita no envio. */
const validDaysOf = (c: Pick<Contract, 'createdAt' | 'expiresAt' | 'sentAt'>) =>
  c.expiresAt ? Math.max(1, Math.round((c.expiresAt.getTime() - (c.sentAt ?? c.createdAt).getTime()) / DAY_MS)) : 15;

function toListItem(c: ContractListRow): ContractListItemDto {
  return {
    id: c.id,
    title: c.title,
    customer: { id: c.customer.id, name: c.customer.name },
    status: c.status,
    totalCents: c.totalCents,
    planType: (c.chargePlan as ChargePlan).type,
    sentAt: c.sentAt?.toISOString() ?? null,
    signedAt: c.signedAt?.toISOString() ?? null,
    expiresAt: c.expiresAt?.toISOString() ?? null,
    chargeGeneratedAt: c.chargeGeneratedAt?.toISOString() ?? null,
    chargeError: c.chargeError,
    createdAt: c.createdAt.toISOString(),
  };
}

/** CTR-02, CTR-03, CTR-06, CTR-07: rascunho → envio ao provedor → acompanhamento. */
@Injectable()
export class ContractsService {
  private readonly minChargeCents: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    @Inject(CONTRACT_PROVIDER) private readonly provider: ContractProvider,
    @InjectQueue(CONTRACT_CHARGE_QUEUE) private readonly chargeQueue: Queue,
    config: ConfigService<Env, true>,
  ) {
    this.minChargeCents = config.get('ASAAS_MIN_CHARGE_CENTS', { infer: true });
  }

  async list(q: ContractListQuery): Promise<Paginated<ContractListItemDto>> {
    const search = q.search?.trim();
    const where: Prisma.ContractWhereInput = {
      status: q.status,
      customerId: q.customerId,
      createdAt: q.from || q.to ? { gte: q.from && new Date(`${q.from}T00:00:00-03:00`), lte: q.to && new Date(`${q.to}T23:59:59.999-03:00`) } : undefined,
      ...(search && {
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { customer: { name: { contains: search, mode: 'insensitive' } } },
        ],
      }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.contract.findMany({ where, include: listInclude, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.contract.count({ where }),
    ]);
    return { data: rows.map(toListItem), meta: { page: q.page, pageSize: q.pageSize, total } };
  }

  async get(id: string): Promise<ContractDetailDto> {
    const c = await this.prisma.contract.findUnique({
      where: { id },
      include: { ...listInclude, template: { select: { id: true, name: true } }, signers: { orderBy: [{ signOrder: 'asc' }, { role: 'asc' }] } },
    });
    if (!c) throw contractNotFound();
    const [charges, subscription, events] = await Promise.all([
      this.prisma.charge.findMany({
        where: { contractId: id },
        include: { customer: { select: { id: true, name: true } }, subscription: { select: { cycle: true } } },
        orderBy: [{ dueDate: 'asc' }, { installmentNumber: 'asc' }],
      }),
      this.prisma.subscription.findUnique({ where: { contractId: id }, include: { customer: { select: { id: true, name: true } } } }),
      c.providerDocumentId
        ? this.prisma.webhookEvent.findMany({
            where: { source: 'CONTRACT', resourceId: c.providerDocumentId },
            orderBy: { receivedAt: 'desc' },
            select: { id: true, event: true, receivedAt: true, processedAt: true, result: true },
          })
        : [],
    ]);
    return {
      ...toListItem(c),
      template: c.template,
      provider: c.provider as ContractProviderName,
      providerError: c.providerError,
      chargePlan: c.chargePlan as ChargePlan,
      validDays: validDaysOf(c),
      variables: (c.variables ?? {}) as Record<string, string>,
      hasSignedFile: c.signedFileKey !== null,
      signers: c.signers.map((s) => ({
        id: s.id,
        role: s.role,
        name: s.name,
        email: s.email,
        phone: s.phone,
        signOrder: s.signOrder,
        authMethod: s.authMethod as AuthMethod,
        status: s.status,
        signUrl: s.signUrl,
        signedAt: s.signedAt?.toISOString() ?? null,
      })),
      charges: charges.map(toChargeListItemDto),
      subscription: subscription ? toSubscriptionListItemDto(subscription) : null,
      events: events.map((e) => ({
        id: e.id,
        event: e.event,
        receivedAt: e.receivedAt.toISOString(),
        processedAt: e.processedAt?.toISOString() ?? null,
        result: e.result,
      })),
    };
  }

  /** CTR-02.1: rascunho com cliente ativo, modelo ativo, plano, signatários e validade. */
  async create(input: ContractDraft, actor: JwtPayload): Promise<ContractDetailDto> {
    const customer = await this.prisma.customer.findUnique({ where: { id: input.customerId } });
    if (!customer) throw customerNotFound();
    if (customer.archivedAt) throw customerArchived();
    const template = await this.activeTemplate(input.templateId);
    const now = new Date();

    const contract = await this.prisma.$transaction(async (tx) => {
      const row = await tx.contract.create({
        data: {
          customerId: customer.id,
          templateId: template.id,
          title: input.title,
          provider: this.provider.name,
          variables: {},
          chargePlan: input.chargePlan as unknown as Prisma.InputJsonValue,
          totalCents: this.total(input.chargePlan),
          expiresAt: new Date(now.getTime() + input.validDays * DAY_MS),
          createdAt: now,
          createdById: actor.sub,
          signers: { create: input.signers.map(signerData) },
        },
      });
      await this.audit.record({ userId: actor.sub, action: 'contract.create', entity: 'contract', entityId: row.id, data: { title: row.title } }, tx);
      return row;
    });
    return this.get(contract.id);
  }

  /** CTR-02.7: só rascunho. */
  async update(id: string, input: ContractUpdateInput, actor: JwtPayload): Promise<ContractDetailDto> {
    const current = await this.prisma.contract.findUnique({ where: { id } });
    if (!current) throw contractNotFound();
    if (current.status !== 'DRAFT') throw contractNotDraft();
    if (input.templateId) await this.activeTemplate(input.templateId);

    await this.prisma.$transaction(async (tx) => {
      await tx.contract.update({
        where: { id },
        data: {
          title: input.title,
          templateId: input.templateId,
          ...(input.chargePlan && {
            chargePlan: input.chargePlan as unknown as Prisma.InputJsonValue,
            totalCents: this.total(input.chargePlan),
          }),
          ...(input.validDays && { expiresAt: new Date(current.createdAt.getTime() + input.validDays * DAY_MS) }),
        },
      });
      if (input.signers) {
        await tx.contractSigner.deleteMany({ where: { contractId: id } });
        await tx.contractSigner.createMany({ data: input.signers.map((s) => ({ ...signerData(s), contractId: id })) });
      }
      await this.audit.record({ userId: actor.sub, action: 'contract.update', entity: 'contract', entityId: id, data: { fields: Object.keys(input) } }, tx);
    });
    return this.get(id);
  }

  /** CTR-02.5, CTR-02.6: variáveis resolvidas, o que falta e o plano calculado. */
  async preview(id: string): Promise<ContractPreviewDto> {
    const c = await this.prisma.contract.findUnique({ where: { id }, include: { customer: true, template: true } });
    if (!c) throw contractNotFound();
    return await this.resolve(c, c.customer, c.template.variableMap as Record<string, string>);
  }

  /**
   * CTR-03: congela variáveis e plano, cria no provedor retomando do passo que falhou (`provider_progress`)
   * e marca SENT. Falha no provedor: continua DRAFT com `provider_error`.
   */
  async send(id: string, actor: JwtPayload): Promise<ContractDetailDto> {
    const c = await this.prisma.contract.findUnique({ where: { id }, include: { customer: true, template: true, signers: true } });
    if (!c) throw contractNotFound();
    if (c.status !== 'DRAFT') throw contractNotDraft();
    if (c.customer.archivedAt) throw customerArchived();
    if (!c.template.active) throw templateInactive();
    if (!isAddressComplete(c.customer.address)) throw customerAddressRequired();

    const preview = await this.resolve(c, c.customer, c.template.variableMap as Record<string, string>);
    if (preview.planError) throw new DomainException('CONTRACT_PLAN_INVALID', preview.planError, HttpStatus.UNPROCESSABLE_ENTITY);
    if (preview.missing.length) throw contractMissingVariables(preview.missing);
    const fields = preview.fields as Record<string, string>;
    const expiresAt = new Date(Date.now() + validDaysOf(c) * DAY_MS);

    await this.prisma.contract.update({
      where: { id },
      data: { variables: fields, totalCents: preview.plan!.totalCents, expiresAt },
    });

    let doc;
    try {
      doc = await this.provider.createDocument({
        externalId: c.id,
        title: c.title,
        templateId: c.template.providerTemplateId,
        fields,
        signers: c.signers.map((s) => ({
          externalId: s.id,
          name: s.name,
          email: s.email,
          phone: s.phone ?? undefined,
          document: s.document ?? undefined,
          role: s.role,
          order: s.signOrder,
          authMethod: s.authMethod as AuthMethod,
        })),
        expiresAt,
        locale: 'pt-BR',
        resume: (c.providerProgress ?? undefined) as ProviderProgress | undefined,
        onProgress: async (p) => {
          await this.prisma.contract.update({
            where: { id },
            data: {
              providerProgress: p as Prisma.InputJsonValue,
              providerEnvelopeId: p.envelopeId ?? null,
              providerDocumentId: p.documentId ?? null,
            },
          });
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha no provedor de contratos';
      await this.prisma.contract.update({ where: { id }, data: { providerError: message } });
      throw error instanceof DomainException ? error : new ContractProviderError(message);
    }

    await this.prisma.$transaction(async (tx) => {
      for (const s of doc.signers) {
        await tx.contractSigner.update({
          where: { id: s.externalId },
          data: { providerSignerId: s.providerSignerId, signUrl: s.signUrl ?? null },
        });
      }
      await tx.contract.update({
        where: { id },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          providerError: null,
          providerEnvelopeId: doc.providerEnvelopeId ?? null,
          providerDocumentId: doc.providerDocumentId,
        },
      });
      await this.audit.record({ userId: actor.sub, action: 'contract.send', entity: 'contract', entityId: id, data: { provider: this.provider.name } }, tx);
    });
    return this.get(id);
  }

  async discard(id: string, actor: JwtPayload): Promise<ContractDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.contract.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'CANCELED', canceledAt: new Date() } });
      if (count === 0) throw (await tx.contract.count({ where: { id } })) ? contractNotDraft() : contractNotFound();
      await this.audit.record({ userId: actor.sub, action: 'contract.discard', entity: 'contract', entityId: id }, tx);
    });
    return this.get(id);
  }

  /** CTR-06.2, CTR-06.4: só enviado e não assinado; cancela no provedor. */
  async cancel(id: string, reason: string | undefined, actor: JwtPayload): Promise<ContractDetailDto> {
    const c = await this.prisma.contract.findUnique({ where: { id } });
    if (!c) throw contractNotFound();
    if (!(OPEN_STATUSES as readonly string[]).includes(c.status) || !c.providerDocumentId) throw contractNotCancelable();
    await this.provider.cancelDocument(c.providerDocumentId);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.contract.updateMany({
        where: { id, status: { in: [...OPEN_STATUSES] } },
        data: { status: 'CANCELED', canceledAt: new Date() },
      });
      if (count === 0) throw contractNotCancelable();
      await this.audit.record({ userId: actor.sub, action: 'contract.cancel', entity: 'contract', entityId: id, data: { reason: reason ?? null } }, tx);
    });
    return this.get(id);
  }

  /** CTR-06.1 */
  async resend(id: string, signerId: string, actor: JwtPayload): Promise<void> {
    const signer = await this.prisma.contractSigner.findFirst({ where: { id: signerId, contractId: id }, include: { contract: true } });
    if (!signer) throw contractNotFound();
    if (signer.status !== 'PENDING' || !signer.providerSignerId || !signer.contract.providerDocumentId) throw signerNotPending();
    if (!(OPEN_STATUSES as readonly string[]).includes(signer.contract.status)) throw signerNotPending();
    await this.provider.resendToSigner(signer.contract.providerDocumentId, signer.providerSignerId);
    await this.audit.record({ userId: actor.sub, action: 'contract.resend', entity: 'contract', entityId: id, data: { signerId } });
  }

  /** CTR-05.4: "Tentar gerar cobrança", inclusive depois de esgotar as tentativas automáticas. */
  async generateCharge(id: string, actor: JwtPayload): Promise<{ queued: boolean }> {
    const c = await this.prisma.contract.findUnique({ where: { id } });
    if (!c) throw contractNotFound();
    if (c.chargeGeneratedAt) throw contractChargeAlreadyGenerated();
    if (c.status !== 'SIGNED') throw contractNotSigned();
    const queued = await requeue(this.chargeQueue, CONTRACT_CHARGE_JOB, { contractId: id }, contractChargeJobId(id), CONTRACT_CHARGE_JOB_OPTIONS);
    await this.audit.record({ userId: actor.sub, action: 'contract.generate_charge', entity: 'contract', entityId: id });
    return { queued };
  }

  /** CTR-NF2: link assinado de curta duração. */
  async signedFileUrl(id: string): Promise<{ url: string }> {
    const c = await this.prisma.contract.findUnique({ where: { id }, select: { signedFileKey: true } });
    if (!c) throw contractNotFound();
    if (!c.signedFileKey) throw signedFileMissing();
    return { url: this.storage.signedPath(c.signedFileKey) };
  }

  private async activeTemplate(id: string) {
    const template = await this.prisma.contractTemplate.findUnique({ where: { id } });
    if (!template) throw templateNotFound();
    if (!template.active) throw templateInactive();
    return template;
  }

  private total(plan: ChargePlan): number {
    return plan.items.reduce((s, i) => s + i.quantity * i.unitPriceCents, 0) - (plan.discountCents ?? 0);
  }

  private async resolve(c: Contract, customer: Customer, variableMap: Record<string, string>): Promise<ContractPreviewDto> {
    const settings = await this.prisma.settings.findUnique({
      where: { id: 1 },
      select: { companyName: true, companyDocument: true, companyCity: true },
    });
    return resolveContractVariables({
      customer,
      plan: c.chargePlan as ChargePlan,
      settings: settings ?? { companyName: null, companyDocument: null, companyCity: null },
      variableMap,
      today: todayInSaoPaulo(),
      minChargeCents: this.minChargeCents,
    });
  }
}

function signerData(s: ContractDraft['signers'][number]) {
  return {
    role: s.role,
    name: s.name,
    email: s.email,
    phone: s.phone ?? null,
    document: s.document || null,
    signOrder: s.signOrder,
    authMethod: s.authMethod,
  };
}
