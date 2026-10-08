import { Injectable } from '@nestjs/common';
import type {
  ServiceCreateInput,
  ServiceDto,
  ServiceListItemDto,
  ServiceListQuery,
  ServiceUpdateInput,
} from '@financeiro/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, type Service } from '../../generated/prisma/client.js';
import type { JwtPayload } from '../../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import { auditDiff } from '../audit/audit-diff';
import { serviceDuplicate, serviceInUse, serviceNotFound } from './services.errors';
import { toServiceDto } from './services.mapper';

type Db = PrismaService | Prisma.TransactionClient;

const AUDITED_FIELDS = ['name', 'description', 'defaultPriceCents', 'active'] as const;

/** O único índice único de `services` além da PK é `services_name_active_uq` (SRV-01.2). */
function isNameConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

@Injectable()
export class ServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** SRV-03.1 */
  async list(query: ServiceListQuery): Promise<{ data: ServiceListItemDto[] }> {
    const rows = await this.prisma.service.findMany({
      where: {
        ...(query.status !== 'all' && { active: query.status === 'active' }),
        ...(query.search && {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { description: { contains: query.search, mode: 'insensitive' } },
          ],
        }),
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    const usage = await this.usageCounts(rows.map((r) => r.id));
    return { data: rows.map((r) => ({ ...toServiceDto(r), usageCount: usage.get(r.id) ?? 0 })) };
  }

  async create(input: ServiceCreateInput, actor: JwtPayload): Promise<ServiceDto> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.service.create({
          data: {
            name: input.name,
            description: input.description ?? null,
            defaultPriceCents: input.defaultPriceCents,
            active: input.active,
          },
        });
        await this.audit.record(
          {
            userId: actor.sub,
            action: 'service.create',
            entity: 'service',
            entityId: row.id,
            data: { name: row.name, defaultPriceCents: row.defaultPriceCents, active: row.active },
          },
          tx,
        );
        return toServiceDto(row);
      });
    } catch (error) {
      if (isNameConflict(error)) throw serviceDuplicate();
      throw error;
    }
  }

  /** SRV-01 e SRV-02.1 (ativar/desativar). SRV-01.3: itens já criados guardam o próprio preço. */
  async update(id: string, input: ServiceUpdateInput, actor: JwtPayload): Promise<ServiceDto> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const before = await this.lock(tx, id);
        const after = await tx.service.update({
          where: { id },
          data: {
            ...(input.name !== undefined && { name: input.name }),
            ...(input.description !== undefined && { description: input.description }),
            ...(input.defaultPriceCents !== undefined && { defaultPriceCents: input.defaultPriceCents }),
            ...(input.active !== undefined && { active: input.active }),
          },
        });
        // SRV-NF1: preço (e demais campos) antes/depois.
        const diff = auditDiff(before, after, AUDITED_FIELDS);
        if (diff) {
          await this.audit.record(
            { userId: actor.sub, action: 'service.update', entity: 'service', entityId: id, data: diff },
            tx,
          );
        }
        return toServiceDto(after);
      });
    } catch (error) {
      if (isNameConflict(error)) throw serviceDuplicate();
      throw error;
    }
  }

  /** SRV-02.2: só serviço nunca usado em item de cobrança/assinatura nem em plano de contrato. */
  async remove(id: string, actor: JwtPayload): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const service = await this.lock(tx, id);
      if (await this.isUsed(tx, id)) throw serviceInUse();
      await tx.service.delete({ where: { id } });
      await this.audit.record(
        {
          userId: actor.sub,
          action: 'service.delete',
          entity: 'service',
          entityId: id,
          data: { name: service.name, defaultPriceCents: service.defaultPriceCents },
        },
        tx,
      );
    });
  }

  private async lock(tx: Prisma.TransactionClient, id: string): Promise<Service> {
    await tx.$queryRaw`SELECT id FROM services WHERE id = ${id}::uuid FOR UPDATE`;
    const row = await tx.service.findUnique({ where: { id } });
    if (!row) throw serviceNotFound();
    return row;
  }

  /**
   * Vendas distintas por serviço, numa consulta só: cobranças fora de assinatura contam por
   * grupo (parcelamento = 1) e cada assinatura conta 1 (design da spec 02).
   */
  private async usageCounts(ids: string[], db: Db = this.prisma): Promise<Map<string, number>> {
    if (!ids.length) return new Map();
    const rows = await db.$queryRaw<Array<{ service_id: string; usage_count: number }>>`
      SELECT service_id, count(*)::int AS usage_count
      FROM (
        SELECT ci.service_id, 'charge:' || COALESCE(c.group_key, c.id::text) AS sale
        FROM charge_items ci
        JOIN charges c ON c.id = ci.charge_id
        WHERE ci.service_id = ANY(${ids}::uuid[]) AND c.subscription_id IS NULL
        UNION
        SELECT si.service_id, 'subscription:' || si.subscription_id::text
        FROM subscription_items si
        WHERE si.service_id = ANY(${ids}::uuid[])
      ) sales
      GROUP BY service_id`;
    return new Map(rows.map((r) => [r.service_id, r.usage_count]));
  }

  private async isUsed(db: Db, id: string): Promise<boolean> {
    const inPlan = JSON.stringify({ items: [{ serviceId: id }] });
    const [row] = await db.$queryRaw<Array<{ used: boolean }>>`
      SELECT EXISTS (SELECT 1 FROM charge_items WHERE service_id = ${id}::uuid)
          OR EXISTS (SELECT 1 FROM subscription_items WHERE service_id = ${id}::uuid)
          OR EXISTS (SELECT 1 FROM contracts WHERE charge_plan @> ${inPlan}::jsonb) AS used`;
    return row?.used ?? false;
  }
}
