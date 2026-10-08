import { Injectable } from '@nestjs/common';
import type { AuditLogDto, AuditLogQuery } from '@financeiro/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client.js';
import { paginatedResponse, paginationToSkipTake, type PaginatedResponse } from '../../common/pagination';

export interface AuditEntry {
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  /** Contexto serializável em JSON, sem dados sensíveis (senha, documento completo, tokens). */
  data?: Record<string, unknown>;
}

type Db = Pick<Prisma.TransactionClient, 'auditLog'>;

const DAY_MS = 24 * 60 * 60 * 1000;

// São Paulo não tem horário de verão desde 2019: o início do dia é sempre 00:00-03:00.
function startOfDayInSaoPaulo(date: string): Date {
  return new Date(`${date}T00:00:00-03:00`);
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Passe `db` para gravar dentro de uma transação já aberta. */
  async record(entry: AuditEntry, db: Db = this.prisma): Promise<void> {
    await db.auditLog.create({
      data: {
        userId: entry.userId ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        data: entry.data as Prisma.InputJsonObject | undefined,
      },
    });
  }

  async list(query: AuditLogQuery): Promise<PaginatedResponse<AuditLogDto>> {
    const createdAt: Prisma.DateTimeFilter = {};
    if (query.from) createdAt.gte = startOfDayInSaoPaulo(query.from);
    if (query.to) createdAt.lt = new Date(startOfDayInSaoPaulo(query.to).getTime() + DAY_MS);

    const where: Prisma.AuditLogWhereInput = {
      ...(query.entity ? { entity: query.entity } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.from || query.to ? { createdAt } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...paginationToSkipTake(query),
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    const userIds = [...new Set(rows.map((r) => r.userId).filter((id): id is string => !!id))];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true },
        })
      : [];
    const names = new Map(users.map((u) => [u.id, u.name]));

    return paginatedResponse(
      rows.map((r) => ({
        id: r.id,
        action: r.action,
        entity: r.entity,
        entityId: r.entityId,
        userId: r.userId,
        userName: r.userId ? (names.get(r.userId) ?? null) : null,
        data: r.data,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      query,
    );
  }
}
