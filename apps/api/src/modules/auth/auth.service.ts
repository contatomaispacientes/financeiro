import { createHmac, randomBytes } from 'node:crypto';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import type { AuthUser, LoginInput, Role } from '@financeiro/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client.js';
import type { Env } from '../../config/env.schema';
import type { JwtPayload } from '../../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import { invalidCredentials, sessionExpired } from './auth.errors';
import { REFRESH_TTL_MS } from './refresh-cookie';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

type Db = Pick<Prisma.TransactionClient, 'refreshToken'>;

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
}

@Injectable()
export class AuthService implements OnModuleInit {
  // Verificar contra um hash fixo quando o e-mail não existe evita que o tempo de resposta revele contas.
  private dummyHash = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit() {
    this.dummyHash = await argon2.hash(randomBytes(16).toString('hex'), { type: argon2.argon2id });
  }

  async login(input: LoginInput): Promise<IssuedTokens> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    const passwordOk = await argon2
      .verify(user?.passwordHash ?? this.dummyHash, input.password)
      .catch(() => false);

    if (!user || !passwordOk || !user.active) {
      const reason = !user ? 'UNKNOWN_EMAIL' : !passwordOk ? 'WRONG_PASSWORD' : 'INACTIVE';
      // O motivo fica só na auditoria (ADMIN); a resposta é sempre a mesma (FND-02.2).
      await this.audit.record({
        userId: user?.id ?? null,
        action: 'auth.login_failed',
        entity: 'user',
        entityId: user?.id ?? null,
        data: { email: input.email, reason },
      });
      throw invalidCredentials();
    }

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.record({ userId: user.id, action: 'auth.login', entity: 'user', entityId: user.id });
    return this.issueTokens(user);
  }

  async refresh(token: string | undefined): Promise<IssuedTokens> {
    if (!token) throw sessionExpired();
    const tokenHash = this.hashToken(token);

    const owner = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: { userId: true },
    });
    if (!owner) throw sessionExpired();

    // Trava o usuário: refreshes concorrentes rodam em fila, e o reuso detectado
    // pelo segundo também revoga o token que o primeiro acabou de emitir.
    const issued = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${owner.userId}::uuid FOR UPDATE`;

      const record = await tx.refreshToken.findUnique({
        where: { tokenHash },
        include: { user: true },
      });
      if (!record) return null;

      if (record.revokedAt) {
        await this.revokeAll(tx, record.userId);
        return null;
      }
      if (record.expiresAt <= new Date() || !record.user.active) return null;

      await tx.refreshToken.update({ where: { id: record.id }, data: { revokedAt: new Date() } });
      return this.issueTokens(record.user, tx);
    });

    if (!issued) throw sessionExpired();
    return issued;
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hashToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async me(userId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.active) throw sessionExpired();
    return this.toAuthUser(user);
  }

  private async issueTokens(user: UserRow, db: Db = this.prisma): Promise<IssuedTokens> {
    const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role };
    const accessToken = await this.jwt.signAsync(payload);
    const refreshToken = randomBytes(32).toString('base64url');

    await db.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      },
    });

    return { accessToken, refreshToken, user: this.toAuthUser(user) };
  }

  private revokeAll(db: Db, userId: string) {
    return db.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private hashToken(token: string): string {
    return createHmac('sha256', this.config.get('JWT_REFRESH_SECRET', { infer: true }))
      .update(token)
      .digest('hex');
  }

  private toAuthUser(user: UserRow): AuthUser {
    return { id: user.id, name: user.name, email: user.email, role: user.role };
  }
}
