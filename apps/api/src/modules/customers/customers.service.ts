import { Injectable } from '@nestjs/common';
import {
  maskDocument,
  personTypeFromDocument,
  type CustomerCreateInput,
  type CustomerDetailDto,
  type CustomerDto,
  type CustomerLookupDto,
  type CustomerUpdateInput,
  type Role,
} from '@financeiro/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, type Customer } from '../../generated/prisma/client.js';
import type { JwtPayload } from '../../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import { auditDiff } from '../audit/audit-diff';
import { computeTotals } from './customer-totals';
import {
  customerDocumentLocked,
  customerDuplicate,
  customerNotFound,
  type DocumentLockReason,
} from './customers.errors';
import { normalizeAddress, toCustomerDto, toDateOnly } from './customers.mapper';

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

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

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
        return toCustomerDto(after, actor.role);
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
