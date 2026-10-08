import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  ConnectionTestResult,
  EnvironmentDto,
  IntegrationsStatusDto,
  SettingsDto,
  SettingsUpdateInput,
} from '@financeiro/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client.js';
import type { Env } from '../../config/env.schema';
import { AuditService } from '../audit/audit.service';
import { auditDiff } from '../audit/audit-diff';
import { ASAAS_CLIENT, type AsaasClient } from '../../integrations/asaas/asaas.client';

const SETTINGS_ID = 1;
const ASAAS_TEST_ACTION = 'integration.asaas_test';

type SettingsRow = Prisma.SettingsGetPayload<object>;
type Db = Pick<Prisma.TransactionClient, 'settings'>;

const AUDITED_FIELDS = [
  'companyName',
  'companyDocument',
  'companyCity',
  'defaultDueDays',
  'defaultFinePct',
  'defaultInterestPct',
  'contractChargeDueDays',
  'reminderDaysBefore',
  'reminderOnDueDate',
  'reminderDaysAfter',
  'reminderChannels',
  'companySignerName',
  'companySignerEmail',
  'companySignerPhone',
] as const satisfies readonly (keyof SettingsDto)[];

function toDto(row: SettingsRow): SettingsDto {
  return {
    companyName: row.companyName,
    companyDocument: row.companyDocument,
    companyCity: row.companyCity,
    defaultDueDays: row.defaultDueDays,
    defaultFinePct: row.defaultFinePct.toNumber(),
    defaultInterestPct: row.defaultInterestPct.toNumber(),
    contractChargeDueDays: row.contractChargeDueDays,
    reminderDaysBefore: row.reminderDaysBefore,
    reminderOnDueDate: row.reminderOnDueDate,
    reminderDaysAfter: row.reminderDaysAfter,
    reminderChannels: row.reminderChannels as SettingsDto['reminderChannels'],
    companySignerName: row.companySignerName,
    companySignerEmail: row.companySignerEmail,
    companySignerPhone: row.companySignerPhone,
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<Env, true>,
    @Inject(ASAAS_CLIENT) private readonly asaas: AsaasClient,
  ) {}

  async get(): Promise<SettingsDto> {
    return toDto(await this.ensureRow(this.prisma));
  }

  async update(input: SettingsUpdateInput, actorId: string): Promise<SettingsDto> {
    return this.prisma.$transaction(async (tx) => {
      await this.ensureRow(tx);
      // Trava a linha: dois PATCH simultâneos geram dois registros de auditoria coerentes.
      await tx.$queryRaw`SELECT id FROM settings WHERE id = ${SETTINGS_ID} FOR UPDATE`;
      const before = toDto(await tx.settings.findUniqueOrThrow({ where: { id: SETTINGS_ID } }));
      const after = toDto(await tx.settings.update({ where: { id: SETTINGS_ID }, data: input }));

      const diff = auditDiff(before, after, AUDITED_FIELDS);
      if (diff) {
        await this.audit.record(
          {
            userId: actorId,
            action: 'settings.update',
            entity: 'settings',
            entityId: String(SETTINGS_ID),
            data: diff,
          },
          tx,
        );
      }
      return after;
    });
  }

  environment(): EnvironmentDto {
    return {
      asaasEnv: this.config.get('ASAAS_ENV', { infer: true }),
      minChargeCents: this.config.get('ASAAS_MIN_CHARGE_CENTS', { infer: true }),
    };
  }

  async integrations(): Promise<IntegrationsStatusDto> {
    const c = this.config;
    const lastTest = await this.prisma.auditLog.findFirst({
      where: { action: ASAAS_TEST_ACTION },
      orderBy: { createdAt: 'desc' },
    });
    const tester = lastTest?.userId
      ? await this.prisma.user.findUnique({ where: { id: lastTest.userId }, select: { name: true } })
      : null;
    const testData = lastTest?.data as Omit<ConnectionTestResult, 'testedAt'> | undefined;

    return {
      asaas: {
        env: c.get('ASAAS_ENV', { infer: true }),
        apiKeyConfigured: Boolean(c.get('ASAAS_API_KEY', { infer: true })),
        webhookTokenConfigured: Boolean(c.get('ASAAS_WEBHOOK_TOKEN', { infer: true })),
        webhookPath: '/api/v1/webhooks/asaas',
        lastTest:
          lastTest && testData
            ? {
                ok: testData.ok,
                latencyMs: testData.latencyMs,
                error: testData.error,
                testedAt: lastTest.createdAt.toISOString(),
                testedBy: tester?.name ?? null,
              }
            : null,
      },
      contracts: {
        provider: c.get('CONTRACT_PROVIDER', { infer: true }),
        env: c.get('CLICKSIGN_ENV', { infer: true }),
        accessTokenConfigured: Boolean(c.get('CLICKSIGN_ACCESS_TOKEN', { infer: true })),
        hmacSecretConfigured: Boolean(c.get('CLICKSIGN_HMAC_SECRET', { infer: true })),
        webhookPath: `/api/v1/webhooks/contracts/${c.get('CONTRACT_PROVIDER', { infer: true })}`,
      },
      mail: {
        configured: Boolean(c.get('SMTP_HOST', { infer: true })),
        host: c.get('SMTP_HOST', { infer: true }),
        port: c.get('SMTP_PORT', { infer: true }),
        from: c.get('MAIL_FROM', { infer: true }),
      },
    };
  }

  async testAsaas(actorId: string): Promise<ConnectionTestResult> {
    const result = await this.asaas.ping();
    const { createdAt } = await this.prisma.auditLog.create({
      data: {
        userId: actorId,
        action: ASAAS_TEST_ACTION,
        entity: 'integration',
        entityId: 'asaas',
        data: { ok: result.ok, latencyMs: result.latencyMs, error: result.error },
      },
    });
    return { ...result, testedAt: createdAt.toISOString() };
  }

  private ensureRow(db: Db) {
    return db.settings.upsert({ where: { id: SETTINGS_ID }, update: {}, create: { id: SETTINGS_ID } });
  }
}
