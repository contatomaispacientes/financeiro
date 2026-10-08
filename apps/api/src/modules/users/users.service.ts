import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import type { Role, UserCreateInput, UserDto, UserUpdateInput } from '@financeiro/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service';
import { auditDiff } from '../audit/audit-diff';
import {
  paginatedResponse,
  paginationToSkipTake,
  type PaginatedResponse,
  type PaginationQuery,
} from '../../common/pagination';
import { emailInUse, lastAdmin, userNotFound } from './users.errors';

const AUDITED_FIELDS = ['name', 'email', 'role', 'active'] as const;

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

function toDto(user: UserRow): UserDto {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role as Role,
    active: user.active,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: PaginationQuery): Promise<PaginatedResponse<UserDto>> {
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({ orderBy: { name: 'asc' }, ...paginationToSkipTake(query) }),
      this.prisma.user.count(),
    ]);
    return paginatedResponse(rows.map(toDto), total, query);
  }

  async get(id: string): Promise<UserDto> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw userNotFound();
    return toDto(user);
  }

  async create(input: UserCreateInput, actorId: string): Promise<UserDto> {
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { name: input.name, email: input.email, role: input.role, passwordHash },
        });
        await this.audit.record(
          {
            userId: actorId,
            action: 'user.create',
            entity: 'user',
            entityId: user.id,
            data: { name: user.name, email: user.email, role: user.role },
          },
          tx,
        );
        return toDto(user);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw emailInUse();
      throw error;
    }
  }

  async update(id: string, input: UserUpdateInput, actorId: string): Promise<UserDto> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Trava os admins ativos: duas remoções simultâneas não podem zerar os administradores.
        const activeAdmins = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM users WHERE role = 'ADMIN' AND active = true FOR UPDATE`;

        const before = await tx.user.findUnique({ where: { id } });
        if (!before) throw userNotFound();

        const losesAdmin =
          before.role === 'ADMIN' &&
          before.active &&
          (input.active === false || (input.role !== undefined && input.role !== 'ADMIN'));
        if (losesAdmin && activeAdmins.length <= 1) throw lastAdmin();

        const after = await tx.user.update({ where: { id }, data: input });

        // Sessões antigas carregam o papel antigo; desativação ou troca de papel força novo login.
        if (after.active !== before.active || after.role !== before.role) {
          await tx.refreshToken.updateMany({
            where: { userId: id, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        }

        const diff = auditDiff(before, after, AUDITED_FIELDS);
        if (diff) {
          await this.audit.record(
            { userId: actorId, action: 'user.update', entity: 'user', entityId: id, data: diff },
            tx,
          );
        }
        return toDto(after);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw emailInUse();
      throw error;
    }
  }

  async resetPassword(id: string, newPassword: string, actorId: string): Promise<void> {
    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.user.updateMany({ where: { id }, data: { passwordHash } });
      if (count === 0) throw userNotFound();
      await tx.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(
        { userId: actorId, action: 'user.reset_password', entity: 'user', entityId: id },
        tx,
      );
    });
  }
}
