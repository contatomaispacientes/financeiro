import { Inject, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  maskDocument,
  onlyDigits,
  personTypeFromDocument,
  type CustomerCreateInput,
  type CustomerDetailDto,
  type CustomerDto,
  type CustomerListItemDto,
  type CustomerListQuery,
  type CustomerLookupDto,
  type CustomerUpdateInput,
  type Paginated,
  type Role,
} from '@financeiro/shared';
import { ASAAS_CLIENT, type AsaasClient } from '../../integrations/asaas/asaas.client';
import { ASAAS_CUSTOMER_SYNC_QUEUE } from './asaas-customer-sync.processor';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, type Customer } from '../../generated/prisma/client.js';
import type { JwtPayload } from '../../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import { auditDiff } from '../audit/audit-diff';
import { computeTotals } from './customer-totals';
import {
  customerDocumentLocked,
  customerDuplicate,
  customerHasOpenItems,
  customerNotFound,
  type DocumentLockReason,
} from './customers.errors';
import {
  asaasNotificationDisabled,
  documentFor,
  normalizeAddress,
  toAsaasCustomer,
  toCustomerDto,
  toDateOnly,
} from './customers.mapper';

type Tx = Prisma.TransactionClient;

const AUDITED_FIELDS = ['name', 'document', 'email', 'phone', 'address', 'notes', 'remindersEnabled'] as const;

/** CLI-NF2: auditoria nunca guarda o documento completo. */
function auditView(row: Customer) {
  return {
    name: row.name,
    document: maskDocument(row.document),
    email: row.email,
    phone: row.phone,
    address: normalizeAddress(row.address),
    notes: row.notes,
    remindersEnabled: row.remindersEnabled,
  };
}

function isDocumentConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
  return JSON.stringify(error.meta ?? {}).includes('document');
}

/** Campos que existem no cadastro do Asaas: mudança neles dispara a sincronização (CLI-04.2). */
const ASAAS_FIELDS = ['name', 'email', 'phone', 'address', 'remindersEnabled'] as const;

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(ASAAS_CLIENT) private readonly asaas: AsaasClient,
    @InjectQueue(ASAAS_CUSTOMER_SYNC_QUEUE) private readonly syncQueue: Queue,
  ) {}

  /** CLI-02: busca sem acento por nome ou por documento (com ou sem máscara), totais sem N+1. */
  async list(query: CustomerListQuery, role: Role): Promise<Paginated<CustomerListItemDto>> {
    const term = query.search ?? '';
    const digits = onlyDigits(term);
    const conditions: Prisma.Sql[] = [];
    if (!query.archived) conditions.push(Prisma.sql`c.archived_at IS NULL`);
    if (term) {
      // Mesma expressão do índice customers_name_search_idx (migration 20261008120000).
      conditions.push(
        digits.length >= 3
          ? Prisma.sql`(public.f_unaccent(lower(c.name)) LIKE '%' || public.f_unaccent(lower(${term})) || '%' OR c.document LIKE ${`${digits}%`})`
          : Prisma.sql`public.f_unaccent(lower(c.name)) LIKE '%' || public.f_unaccent(lower(${term})) || '%'`,
      );
    }
    const where = conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;

    const [countRows, idRows] = await Promise.all([
      this.prisma.$queryRaw<Array<{ total: bigint }>>`SELECT count(*) AS total FROM customers c ${where}`,
      this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT c.id FROM customers c ${where}
        ORDER BY c.name ASC, c.id ASC
        LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`,
    ]);
    const ids = idRows.map((r) => r.id);

    const [customers, groups] = ids.length
      ? await Promise.all([
          this.prisma.customer.findMany({ where: { id: { in: ids } } }),
          this.prisma.charge.groupBy({
            by: ['customerId', 'status'],
            where: { customerId: { in: ids } },
            _count: { _all: true },
            _sum: { valueCents: true, refundedCents: true },
          }),
        ])
      : [[], []];

    const byId = new Map(customers.map((c) => [c.id, c]));
    const data = ids.map((id) => {
      const c = byId.get(id)!;
      const totals = computeTotals(
        groups
          .filter((g) => g.customerId === id)
          .map((g) => ({
            status: g.status,
            count: g._count._all,
            valueCents: g._sum.valueCents ?? 0,
            refundedCents: g._sum.refundedCents ?? 0,
          })),
      );
      return {
        id: c.id,
        name: c.name,
        personType: c.personType,
        document: documentFor(c.document, role),
        email: c.email,
        phone: c.phone,
        asaasCustomerId: c.asaasCustomerId,
        archivedAt: c.archivedAt?.toISOString() ?? null,
        ...totals,
      };
    });

    return { data, meta: { page: query.page, pageSize: query.pageSize, total: Number(countRows[0]?.total ?? 0) } };
  }

  /** CLI-04.4 */
  async archive(id: string, actor: JwtPayload): Promise<CustomerDto> {
    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({ where: { id } });
      if (!customer) throw customerNotFound();
      if (customer.archivedAt) return toCustomerDto(customer, actor.role);

      const [charges, subscriptions, contracts] = await Promise.all([
        tx.charge.count({ where: { customerId: id, status: { in: ['DRAFT', 'PENDING', 'OVERDUE'] } } }),
        tx.subscription.count({ where: { customerId: id, status: 'ACTIVE' } }),
        tx.contract.count({ where: { customerId: id, status: { in: ['SENT', 'PARTIALLY_SIGNED'] } } }),
      ]);
      if (charges + subscriptions + contracts > 0) throw customerHasOpenItems({ charges, subscriptions, contracts });

      const row = await tx.customer.update({ where: { id }, data: { archivedAt: new Date() } });
      await this.audit.record({ userId: actor.sub, action: 'customer.archive', entity: 'customer', entityId: id }, tx);
      return toCustomerDto(row, actor.role);
    });
  }

  /** CLI-04.5 */
  async unarchive(id: string, actor: JwtPayload): Promise<CustomerDto> {
    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({ where: { id } });
      if (!customer) throw customerNotFound();
      if (!customer.archivedAt) return toCustomerDto(customer, actor.role);
      const row = await tx.customer.update({ where: { id }, data: { archivedAt: null } });
      await this.audit.record({ userId: actor.sub, action: 'customer.unarchive', entity: 'customer', entityId: id }, tx);
      return toCustomerDto(row, actor.role);
    });
  }

  /**
   * CLI-05: garante o cliente no Asaas (reutiliza pelo CPF/CNPJ ou cria) e grava o id.
   * O advisory lock por cliente impede que duas cobranças simultâneas criem dois cadastros.
   */
  async ensureAsaasCustomer(customerId: string): Promise<string> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${customerId}))`;
        const customer = await tx.customer.findUnique({ where: { id: customerId } });
        if (!customer) throw customerNotFound();
        if (customer.asaasCustomerId) return customer.asaasCustomerId;

        const existing = await this.asaas.findCustomerByDocument(customer.document);
        let asaasId = existing?.id;
        if (!asaasId) {
          const settings = await tx.settings.findUnique({ where: { id: 1 } });
          const disabled = asaasNotificationDisabled(customer, settings?.reminderChannels ?? ['ASAAS']);
          asaasId = (await this.asaas.createCustomer(toAsaasCustomer(customer, disabled))).id;
        }
        await tx.customer.update({ where: { id: customerId }, data: { asaasCustomerId: asaasId, asaasSyncError: null } });
        return asaasId;
      },
      // A chamada ao Asaas acontece dentro da transação (timeout de 15 s por requisição).
      { timeout: 60_000, maxWait: 30_000 },
    );
  }

  /** "Tentar de novo" na ficha quando a sincronização falhou. */
  async requestAsaasSync(id: string): Promise<void> {
    const customer = await this.prisma.customer.findUnique({ where: { id }, select: { asaasCustomerId: true } });
    if (!customer) throw customerNotFound();
    if (customer.asaasCustomerId) await this.enqueueSync(id);
  }

  private enqueueSync(customerId: string) {
    return this.syncQueue.add('sync', { customerId }, { attempts: 5, backoff: { type: 'exponential', delay: 2_000 } });
  }

  async create(input: CustomerCreateInput, actor: JwtPayload): Promise<CustomerDto> {
    await this.assertDocumentFree(this.prisma, input.document);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.customer.create({
          data: {
            name: input.name,
            personType: personTypeFromDocument(input.document),
            document: input.document,
            email: input.email ?? null,
            phone: input.phone ?? null,
            address: input.address ?? undefined,
            notes: input.notes ?? null,
            remindersEnabled: input.remindersEnabled,
          },
        });
        await this.audit.record(
          {
            userId: actor.sub,
            action: 'customer.create',
            entity: 'customer',
            entityId: row.id,
            data: { name: row.name, document: maskDocument(row.document), personType: row.personType },
          },
          tx,
        );
        return toCustomerDto(row, actor.role);
      });
    } catch (error) {
      // Corrida: outro cadastro com o mesmo documento entrou entre a checagem e o insert.
      if (isDocumentConflict(error)) await this.assertDocumentFree(this.prisma, input.document);
      throw error;
    }
  }

  async get(id: string, role: Role): Promise<CustomerDetailDto> {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) throw customerNotFound();

    const [groups, charges, subscriptions, contracts] = await Promise.all([
      this.prisma.charge.groupBy({
        by: ['status'],
        where: { customerId: id },
        _count: { _all: true },
        _sum: { valueCents: true, refundedCents: true },
      }),
      this.prisma.charge.findMany({
        where: { customerId: id },
        orderBy: [{ createdAt: 'desc' }, { dueDate: 'desc' }],
        take: 20,
      }),
      this.prisma.subscription.findMany({
        where: { customerId: id, status: 'ACTIVE' },
        orderBy: { nextDueDate: 'asc' },
      }),
      this.prisma.contract.findMany({
        where: { customerId: id },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    return {
      ...toCustomerDto(customer, role),
      totals: computeTotals(
        groups.map((g) => ({
          status: g.status,
          count: g._count._all,
          valueCents: g._sum.valueCents ?? 0,
          refundedCents: g._sum.refundedCents ?? 0,
        })),
      ),
      recentCharges: charges.map((c) => ({
        id: c.id,
        description: c.description,
        type: c.type,
        status: c.status,
        billingType: c.billingType,
        valueCents: c.valueCents,
        dueDate: toDateOnly(c.dueDate),
        paidAt: c.paidAt ? toDateOnly(c.paidAt) : null,
        installmentNumber: c.installmentNumber,
        installmentCount: c.installmentCount,
        asaasPaymentId: c.asaasPaymentId,
      })),
      subscriptions: subscriptions.map((s) => ({
        id: s.id,
        description: s.description,
        status: s.status,
        cycle: s.cycle,
        valueCents: s.valueCents,
        nextDueDate: toDateOnly(s.nextDueDate),
      })),
      contracts: contracts.map((c) => ({
        id: c.id,
        title: c.title,
        status: c.status,
        totalCents: c.totalCents,
        sentAt: c.sentAt?.toISOString() ?? null,
        signedAt: c.signedAt?.toISOString() ?? null,
        createdAt: c.createdAt.toISOString(),
      })),
    };
  }

  async update(id: string, input: CustomerUpdateInput, actor: JwtPayload): Promise<CustomerDto> {
    const { dto, syncAsaas } = await this.updateInTransaction(id, input, actor);
    // Depois do commit: o job relê o cliente já atualizado.
    if (syncAsaas) await this.enqueueSync(id);
    return dto;
  }

  private async updateInTransaction(id: string, input: CustomerUpdateInput, actor: JwtPayload) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Uma edição por vez: a auditoria compara com o estado realmente anterior.
        await tx.$queryRaw`SELECT id FROM customers WHERE id = ${id}::uuid FOR UPDATE`;
        const before = await tx.customer.findUnique({ where: { id } });
        if (!before) throw customerNotFound();

        const newDocument = input.document !== undefined && input.document !== before.document ? input.document : null;
        if (newDocument) {
          const reasons = await this.documentLockReasons(tx, before);
          if (reasons.length) throw customerDocumentLocked(reasons);
          await this.assertDocumentFree(tx, newDocument);
        }

        const data: Prisma.CustomerUpdateInput = {
          ...(input.name !== undefined && { name: input.name }),
          ...(newDocument && { document: newDocument, personType: personTypeFromDocument(newDocument) }),
          ...(input.email !== undefined && { email: input.email }),
          ...(input.phone !== undefined && { phone: input.phone }),
          ...(input.address !== undefined && { address: input.address === null ? Prisma.DbNull : input.address }),
          ...(input.notes !== undefined && { notes: input.notes }),
          ...(input.remindersEnabled !== undefined && { remindersEnabled: input.remindersEnabled }),
        };
        const after = await tx.customer.update({ where: { id }, data });

        const diff = auditDiff(auditView(before), auditView(after), AUDITED_FIELDS);
        if (diff) {
          await this.audit.record(
            { userId: actor.sub, action: 'customer.update', entity: 'customer', entityId: id, data: diff },
            tx,
          );
        }
        const syncAsaas =
          after.asaasCustomerId !== null && ASAAS_FIELDS.some((field) => diff?.after[field] !== undefined);
        return { dto: toCustomerDto(after, actor.role), syncAsaas };
      });
    } catch (error) {
      if (isDocumentConflict(error) && input.document) await this.assertDocumentFree(this.prisma, input.document);
      throw error;
    }
  }

  /** CLI-01.3: checagem enquanto o usuário digita o documento. */
  async lookup(document: string): Promise<CustomerLookupDto> {
    const existing = await this.prisma.customer.findUnique({
      where: { document },
      select: { id: true, name: true, archivedAt: true },
    });
    return existing
      ? { exists: true, customerId: existing.id, name: existing.name, archived: existing.archivedAt !== null }
      : { exists: false };
  }

  private async assertDocumentFree(db: Tx | PrismaService, document: string) {
    const existing = await db.customer.findUnique({
      where: { document },
      select: { id: true, name: true, archivedAt: true },
    });
    if (existing) throw customerDuplicate(existing);
  }

  /** CLI-04.3: documento fixo depois de cadastro no Asaas, cobrança emitida ou contrato enviado. */
  private async documentLockReasons(tx: Tx, customer: Customer): Promise<DocumentLockReason[]> {
    const [charges, contracts] = await Promise.all([
      tx.charge.count({ where: { customerId: customer.id, status: { not: 'DRAFT' } } }),
      tx.contract.count({ where: { customerId: customer.id, status: { not: 'DRAFT' } } }),
    ]);
    const reasons: DocumentLockReason[] = [];
    if (customer.asaasCustomerId) reasons.push('ASAAS_CUSTOMER');
    if (charges > 0) reasons.push('CHARGES');
    if (contracts > 0) reasons.push('CONTRACTS');
    return reasons;
  }
}
