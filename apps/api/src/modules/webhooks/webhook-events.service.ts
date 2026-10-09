import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type {
  Paginated,
  WebhookEventDetailDto,
  WebhookEventDto,
  WebhookEventQuery,
  WebhookEventState,
  WebhookHealthDto,
} from '@financeiro/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { Prisma, WebhookEvent } from '../../generated/prisma/client.js';
import { DomainException } from '../../common/filters/domain-exception.filter';
import { requeue } from '../../queues/enqueue';
import { ASAAS_EVENT_JOB, ASAAS_EVENT_JOB_OPTIONS, ASAAS_EVENTS_QUEUE, webhookEventJobId } from '../../queues/asaas-events';
import { CONTRACT_EVENT_JOB, CONTRACT_EVENT_JOB_OPTIONS, CONTRACT_EVENTS_QUEUE } from '../../queues/contracts';
import type { JwtPayload } from '../../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';

const IGNORED = ['IGNORED', 'IGNORED_TRANSITION', 'UNKNOWN_RESOURCE'];

/** Situação exibida no log (WHK-03.1). */
function stateOf(e: WebhookEvent): WebhookEventState {
  if (e.processedAt) return e.result && IGNORED.includes(e.result) ? 'ignored' : 'processed';
  return e.error ? 'error' : 'pending';
}

function stateWhere(state: WebhookEventState): Prisma.WebhookEventWhereInput {
  switch (state) {
    case 'processed':
      return { processedAt: { not: null }, OR: [{ result: null }, { result: { notIn: IGNORED } }] };
    case 'ignored':
      return { processedAt: { not: null }, result: { in: IGNORED } };
    case 'error':
      return { processedAt: null, error: { not: null } };
    case 'pending':
      return { processedAt: null, error: null };
  }
}

const notFound = () => new DomainException('NOT_FOUND', 'Evento não encontrado', HttpStatus.NOT_FOUND);

@Injectable()
export class WebhookEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @InjectQueue(ASAAS_EVENTS_QUEUE) private readonly queue: Queue,
    @InjectQueue(CONTRACT_EVENTS_QUEUE) private readonly contractQueue: Queue,
  ) {}

  async list(q: WebhookEventQuery): Promise<Paginated<WebhookEventDto>> {
    const where: Prisma.WebhookEventWhereInput = {
      ...(q.source && { source: q.source }),
      ...(q.event && { event: { contains: q.event, mode: 'insensitive' } }),
      ...(q.resourceId && { resourceId: { contains: q.resourceId } }),
      ...(q.from || q.to
        ? {
            receivedAt: {
              ...(q.from && { gte: new Date(`${q.from}T00:00:00-03:00`) }),
              ...(q.to && { lt: new Date(new Date(`${q.to}T00:00:00-03:00`).getTime() + 86_400_000) }),
            },
          }
        : {}),
      ...(q.state && { AND: [stateWhere(q.state)] }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.webhookEvent.findMany({ where, orderBy: { receivedAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.webhookEvent.count({ where }),
    ]);
    const charges = await this.chargeIds(rows);
    return { data: rows.map((r) => this.toDto(r, charges)), meta: { page: q.page, pageSize: q.pageSize, total } };
  }

  async get(id: string): Promise<WebhookEventDetailDto> {
    const row = await this.prisma.webhookEvent.findUnique({ where: { id } });
    if (!row) throw notFound();
    return { ...this.toDto(row, await this.chargeIds([row])), payload: row.payload };
  }

  /** WHK-03.2: reprocessa mesmo após 5 tentativas (o job falho é removido antes de reenfileirar, ADR-010). */
  async reprocess(id: string, actor: JwtPayload): Promise<WebhookEventDetailDto> {
    const row = await this.prisma.webhookEvent.findUnique({ where: { id } });
    if (!row) throw notFound();
    if (row.processedAt && !row.error) {
      throw new DomainException('EVENT_ALREADY_PROCESSED', 'Este evento já foi processado com sucesso', HttpStatus.CONFLICT);
    }
    await this.prisma.webhookEvent.update({ where: { id }, data: { attempts: 0, error: null, processedAt: null, result: null } });
    if (row.source === 'CONTRACT') {
      await requeue(this.contractQueue, CONTRACT_EVENT_JOB, { webhookEventId: id }, webhookEventJobId(id), CONTRACT_EVENT_JOB_OPTIONS);
    } else {
      await requeue(this.queue, ASAAS_EVENT_JOB, { webhookEventId: id }, webhookEventJobId(id), ASAAS_EVENT_JOB_OPTIONS);
    }
    await this.audit.record({ userId: actor.sub, action: 'webhook_event.reprocess', entity: 'webhook_event', entityId: id, data: { event: row.event } });
    return this.get(id);
  }

  async health(): Promise<WebhookHealthDto> {
    const [oldestPending, last, errors, openCharges] = await Promise.all([
      this.prisma.webhookEvent.findFirst({ where: { processedAt: null }, orderBy: { receivedAt: 'asc' }, select: { receivedAt: true } }),
      this.prisma.webhookEvent.findFirst({ where: { source: 'ASAAS' }, orderBy: { receivedAt: 'desc' }, select: { receivedAt: true } }),
      this.prisma.webhookEvent.count({ where: { error: { not: null }, receivedAt: { gte: new Date(Date.now() - 86_400_000) } } }),
      this.prisma.charge.count({ where: { status: { in: ['PENDING', 'OVERDUE'] } } }),
    ]);
    const oldestPendingMinutes = oldestPending ? Math.floor((Date.now() - oldestPending.receivedAt.getTime()) / 60_000) : null;
    const silentDays = last ? (Date.now() - last.receivedAt.getTime()) / 86_400_000 : Infinity;

    let alert: string | null = null;
    if (oldestPendingMinutes !== null && oldestPendingMinutes > 60) {
      alert = `Há evento do Asaas sem processar há ${oldestPendingMinutes} minutos.`;
    } else if (openCharges > 0 && silentDays > 7) {
      alert = 'Nenhum evento do Asaas recebido em 7 dias, mas há cobranças em aberto. Confira o webhook no painel do Asaas.';
    }
    return { oldestPendingMinutes, lastReceivedAt: last?.receivedAt.toISOString() ?? null, errorsLast24h: errors, openCharges, alert };
  }

  private async chargeIds(rows: WebhookEvent[]) {
    const ids = [...new Set(rows.map((r) => r.resourceId).filter((v): v is string => !!v))];
    if (!ids.length) return new Map<string, string>();
    const charges = await this.prisma.charge.findMany({ where: { asaasPaymentId: { in: ids } }, select: { id: true, asaasPaymentId: true } });
    return new Map(charges.map((c) => [c.asaasPaymentId!, c.id]));
  }

  private toDto(r: WebhookEvent, charges: Map<string, string>): WebhookEventDto {
    return {
      id: r.id,
      source: r.source,
      externalEventId: r.externalEventId,
      event: r.event,
      resourceId: r.resourceId,
      chargeId: r.resourceId ? (charges.get(r.resourceId) ?? null) : null,
      state: stateOf(r),
      result: r.result,
      attempts: r.attempts,
      error: r.error,
      receivedAt: r.receivedAt.toISOString(),
      processedAt: r.processedAt?.toISOString() ?? null,
    };
  }
}
