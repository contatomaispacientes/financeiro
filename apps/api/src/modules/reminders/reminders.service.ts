import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  addDays,
  checkTemplateVariables,
  DEFAULT_REMINDER_TEMPLATES,
  formatBRL,
  renderReminderText,
  todayInSaoPaulo,
  type ReminderKind,
  type ReminderListDto,
  type ReminderListQuery,
  type ReminderPreviewDto,
  type ReminderPreviewInput,
  type ReminderTemplateDto,
  type ReminderTemplateUpsertInput,
  type ReminderVariable,
} from '@financeiro/shared';
import type { JwtPayload } from '../../common/decorators/current-user.decorator';
import { DomainException } from '../../common/filters/domain-exception.filter';
import { Prisma, type Charge, type Customer, type ReminderTemplate } from '../../generated/prisma/client.js';
import { MailProvider } from '../../integrations/mail/mail.provider';
import { PrismaService } from '../../prisma/prisma.service';
import { enqueueUnique } from '../../queues/enqueue';
import { REMINDER_JOB_OPTIONS, REMINDER_SEND_JOB, REMINDERS_QUEUE, reminderJobId, type ReminderJobData } from '../../queues/reminders';
import { AuditService } from '../audit/audit.service';
import { ChargesService } from '../charges/charges.service';
import { chargeNotFound } from '../charges/charges.errors';
import { toDateOnly } from '../customers/customers.mapper';
import { fromDateOnly } from '../charges/charges.mapper';

const OPEN = ['PENDING', 'OVERDUE'] as const;
const SCHEDULED: ReminderKind[] = ['BEFORE_DUE', 'ON_DUE', 'AFTER_DUE'];
const IN_PROGRESS = 'IN_PROGRESS';

const invalid = (message: string) => new DomainException('REMINDER_TEMPLATE_INVALID', message, HttpStatus.UNPROCESSABLE_ENTITY);
const notFound = () => new DomainException('NOT_FOUND', 'Mensagem não encontrada', HttpStatus.NOT_FOUND);

const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => entities[c]!);

function toHtml(text: string): string {
  const body = escapeHtml(text)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
    .replace(/\n/g, '<br>');
  return `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#15171A">${body}</div>`;
}

function toDto(t: ReminderTemplate): ReminderTemplateDto {
  const d = DEFAULT_REMINDER_TEMPLATES[t.kind];
  return {
    id: t.id,
    kind: t.kind,
    channel: t.channel as 'EMAIL' | 'WHATSAPP',
    offsetDays: t.offsetDays,
    subject: t.subject,
    body: t.body,
    active: t.active,
    isDefault: t.body === d.body && (t.channel !== 'EMAIL' || t.subject === d.subject),
    updatedAt: t.updatedAt.toISOString(),
  };
}

/** Régua de cobrança (spec 08): modelos, plano do dia, envio com unicidade, manual e de evento. */
@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailProvider,
    private readonly charges: ChargesService,
    @InjectQueue(REMINDERS_QUEUE) private readonly queue: Queue,
  ) {}

  // ───────── Modelos (REG-08) ─────────

  async listTemplates(): Promise<ReminderTemplateDto[]> {
    const rows = await this.prisma.reminderTemplate.findMany({ orderBy: [{ kind: 'asc' }, { channel: 'asc' }, { offsetDays: 'asc' }] });
    return rows.map(toDto);
  }

  /** REG-08.1–08.3, REG-01.4: cria ou atualiza (kind, channel, offset). */
  async upsertTemplate(input: ReminderTemplateUpsertInput, actor: JwtPayload): Promise<ReminderTemplateDto> {
    const check = checkTemplateVariables(input.kind, input.subject, input.body);
    if (!check.ok) {
      const message =
        check.code === 'REMINDER_UNKNOWN_VARIABLE'
          ? `Variável desconhecida: {${check.variable}}`
          : `{${check.variable}} não existe na mensagem "${input.kind}"`;
      throw new DomainException(check.code, message, HttpStatus.BAD_REQUEST, { variable: check.variable, kind: input.kind });
    }
    if (input.channel === 'EMAIL' && !input.subject) throw invalid('E-mail precisa de assunto');
    if (input.offsetDays !== null && input.kind !== 'BEFORE_DUE' && input.kind !== 'AFTER_DUE') {
      throw invalid('Só "antes do vencimento" e "em atraso" aceitam mensagem por dia');
    }
    if (input.kind === 'MANUAL' && !input.active) throw invalid('O envio manual não pode ser desativado');

    const existing = await this.prisma.reminderTemplate.findFirst({
      where: { kind: input.kind, channel: input.channel, offsetDays: input.offsetDays },
    });
    const data = { subject: input.subject, body: input.body, active: input.active };
    const row = existing
      ? await this.prisma.reminderTemplate.update({ where: { id: existing.id }, data })
      : await this.prisma.reminderTemplate.create({ data: { ...data, kind: input.kind, channel: input.channel, offsetDays: input.offsetDays } });
    await this.audit.record({ userId: actor.sub, action: 'reminder_template.update', entity: 'reminder_template', entityId: row.id, data: { kind: row.kind, offsetDays: row.offsetDays } });
    return toDto(row);
  }

  /** REG-08.2: só as específicas por dia podem ser excluídas. */
  async deleteTemplate(id: string, actor: JwtPayload): Promise<void> {
    const row = await this.prisma.reminderTemplate.findUnique({ where: { id } });
    if (!row) throw notFound();
    if (row.offsetDays === null) throw invalid('A mensagem geral não pode ser excluída; desative-a ou restaure o padrão');
    await this.prisma.reminderTemplate.delete({ where: { id } });
    await this.audit.record({ userId: actor.sub, action: 'reminder_template.delete', entity: 'reminder_template', entityId: id });
  }

  /** REG-08.4 */
  async resetTemplate(id: string, actor: JwtPayload): Promise<ReminderTemplateDto> {
    const row = await this.prisma.reminderTemplate.findUnique({ where: { id } });
    if (!row) throw notFound();
    const d = DEFAULT_REMINDER_TEMPLATES[row.kind];
    const updated = await this.prisma.reminderTemplate.update({
      where: { id },
      data: { subject: row.channel === 'EMAIL' ? d.subject : null, body: d.body },
    });
    await this.audit.record({ userId: actor.sub, action: 'reminder_template.reset', entity: 'reminder_template', entityId: id });
    return toDto(updated);
  }

  /** REG-01.3: prévia com uma cobrança real (a escolhida ou a mais recente). */
  async preview(input: ReminderPreviewInput): Promise<ReminderPreviewDto> {
    const charge = input.chargeId
      ? await this.prisma.charge.findUnique({ where: { id: input.chargeId }, include: { customer: true } })
      : await this.prisma.charge.findFirst({ where: { status: { not: 'DRAFT' } }, orderBy: { createdAt: 'desc' }, include: { customer: true } });
    const values = charge ? await this.values(charge, input.kind, input.offsetDays ?? 0) : {};
    const text = renderReminderText(input.body, values);
    return { subject: renderReminderText(input.subject ?? '', values), text, html: toHtml(text) };
  }

  // ───────── Plano do dia (REG-03.1, REG-03.6) ─────────

  /** Enfileira os lembretes que vencem em `today`; a unicidade fica no banco (REG-03.2). */
  async runDaily(today = todayInSaoPaulo()): Promise<{ queued: number }> {
    const settings = await this.prisma.settings.findUnique({ where: { id: 1 } });
    if (!settings || !settings.reminderChannels.includes('EMAIL')) return { queued: 0 };
    const active = await this.prisma.reminderTemplate.findMany({ where: { channel: 'EMAIL', active: true }, select: { kind: true, offsetDays: true } });
    const isActive = (kind: ReminderKind, offset: number) => active.some((t) => t.kind === kind && (t.offsetDays === offset || t.offsetDays === null));

    const plan: Array<{ kind: ReminderKind; offset: number; due: string; statuses: Array<'PENDING' | 'OVERDUE'> }> = [];
    if (settings.reminderDaysBefore > 0) plan.push({ kind: 'BEFORE_DUE', offset: -settings.reminderDaysBefore, due: addDays(today, settings.reminderDaysBefore), statuses: ['PENDING'] });
    if (settings.reminderOnDueDate) plan.push({ kind: 'ON_DUE', offset: 0, due: today, statuses: ['PENDING', 'OVERDUE'] });
    for (const d of settings.reminderDaysAfter) plan.push({ kind: 'AFTER_DUE', offset: d, due: addDays(today, -d), statuses: ['OVERDUE'] });

    let queued = 0;
    for (const step of plan) {
      if (!isActive(step.kind, step.offset)) continue;
      const charges = await this.prisma.charge.findMany({
        where: { status: { in: step.statuses }, dueDate: fromDateOnly(step.due), customer: { remindersEnabled: true } },
        select: { id: true },
      });
      for (const c of charges) {
        const data: ReminderJobData = { chargeId: c.id, kind: step.kind, channel: 'EMAIL', offsetDays: step.offset, referenceDate: today };
        await enqueueUnique(this.queue, REMINDER_SEND_JOB, data, reminderJobId(data), REMINDER_JOB_OPTIONS);
        queued++;
      }
    }
    return { queued };
  }

  // ───────── Envio (REG-03.2–03.5, REG-04) ─────────

  async send(job: ReminderJobData): Promise<void> {
    const kind = job.kind as ReminderKind;
    const charge = await this.prisma.charge.findUnique({ where: { id: job.chargeId }, include: { customer: true } });
    if (!charge) return;
    // REG-03.3: paga ou cancelada antes do envio → não sai.
    if (SCHEDULED.includes(kind) && !(OPEN as readonly string[]).includes(charge.status)) return;

    const logId = await this.reserve(job);
    if (!logId) return;
    const skip = (reason: string) => this.prisma.reminderLog.update({ where: { id: logId }, data: { status: 'SKIPPED', error: reason } });

    if (!charge.customer.remindersEnabled) return void (await skip('Lembretes desligados para o cliente'));
    if (!charge.customer.email) return void (await skip('Cliente sem e-mail'));
    if (!this.mail.configured) return void (await skip('E-mail não configurado no servidor'));
    const template = await this.resolve(kind, job.channel, job.offsetDays);
    if (!template?.active) return void (await skip('Mensagem desativada'));

    try {
      const values = await this.values(charge, kind, job.offsetDays);
      const text = renderReminderText(template.body, values);
      await this.mail.send({ to: charge.customer.email, subject: renderReminderText(template.subject ?? '', values), text, html: toHtml(text) });
      await this.prisma.reminderLog.update({ where: { id: logId }, data: { status: 'SENT', error: null, sentAt: new Date() } });
    } catch (error) {
      await this.prisma.reminderLog.update({ where: { id: logId }, data: { status: 'FAILED', error: error instanceof Error ? error.message : String(error) } });
      throw error;
    }
  }

  /** Reserva o envio: registro único por (cobrança, tipo, canal, dia); devolve `null` se já foi tratado. */
  private async reserve(job: ReminderJobData): Promise<string | null> {
    const kind = job.kind as ReminderKind;
    try {
      const row = await this.prisma.reminderLog.create({
        data: { chargeId: job.chargeId, kind, channel: job.channel, offsetDays: job.offsetDays, referenceDate: fromDateOnly(job.referenceDate), status: 'SKIPPED', error: IN_PROGRESS },
      });
      return row.id;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
      const existing = await this.prisma.reminderLog.findFirst({ where: { chargeId: job.chargeId, kind, channel: job.channel, offsetDays: job.offsetDays } });
      // Retry deste mesmo job (reserva em andamento ou falha anterior) segue; o resto já foi tratado.
      if (existing && (existing.status === 'FAILED' || existing.error === IN_PROGRESS)) return existing.id;
      return null;
    }
  }

  /** COB-10, REG-04.1: "Enviar ao cliente" com o modelo MANUAL (sempre ativo). */
  async sendManual(chargeId: string, actor: JwtPayload): Promise<{ sentAt: string }> {
    const charge = await this.prisma.charge.findUnique({ where: { id: chargeId }, include: { customer: true } });
    if (!charge) throw chargeNotFound();
    if (!(OPEN as readonly string[]).includes(charge.status)) {
      throw new DomainException('CHARGE_NOT_OPEN', 'Só cobrança pendente ou vencida pode ser enviada', HttpStatus.CONFLICT);
    }
    if (!charge.customer.email) throw new DomainException('CUSTOMER_WITHOUT_EMAIL', 'O cliente não tem e-mail cadastrado', HttpStatus.UNPROCESSABLE_ENTITY);
    if (!this.mail.configured) {
      throw new DomainException('REMINDER_CHANNEL_NOT_CONFIGURED', 'E-mail não configurado no servidor (SMTP)', HttpStatus.UNPROCESSABLE_ENTITY);
    }
    const template = await this.resolve('MANUAL', 'EMAIL', 0);
    const d = DEFAULT_REMINDER_TEMPLATES.MANUAL;
    const values = await this.values(charge, 'MANUAL', 0);
    const text = renderReminderText(template?.body ?? d.body, values);
    const log = { chargeId, kind: 'MANUAL' as const, channel: 'EMAIL' as const, offsetDays: 0, referenceDate: fromDateOnly(todayInSaoPaulo()) };
    try {
      await this.mail.send({ to: charge.customer.email, subject: renderReminderText(template?.subject ?? d.subject, values), text, html: toHtml(text) });
    } catch (error) {
      await this.prisma.reminderLog.create({ data: { ...log, status: 'FAILED', error: error instanceof Error ? error.message : String(error) } });
      throw new DomainException('MAIL_SEND_FAILED', 'Não foi possível enviar o e-mail. Tente de novo.', HttpStatus.BAD_GATEWAY);
    }
    const row = await this.prisma.reminderLog.create({ data: { ...log, status: 'SENT' } });
    await this.audit.record({ userId: actor.sub, action: 'charge.send', entity: 'charge', entityId: chargeId, data: { channel: 'EMAIL' } });
    return { sentAt: row.sentAt.toISOString() };
  }

  // ───────── Histórico (REG-06) ─────────

  async list(q: ReminderListQuery): Promise<ReminderListDto> {
    const base: Prisma.ReminderLogWhereInput = {
      chargeId: q.chargeId,
      ...(q.days && { sentAt: { gte: new Date(Date.now() - q.days * 86_400_000) } }),
      OR: [{ error: null }, { error: { not: IN_PROGRESS } }],
    };
    const where = { ...base, status: q.status };
    const [rows, total, groups] = await Promise.all([
      this.prisma.reminderLog.findMany({
        where,
        include: { charge: { select: { id: true, valueCents: true, customer: { select: { name: true } } } } },
        orderBy: { sentAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.reminderLog.count({ where }),
      this.prisma.reminderLog.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
    ]);
    const summary = { SENT: 0, FAILED: 0, SKIPPED: 0 };
    for (const g of groups) summary[g.status] = g._count._all;
    return {
      data: rows.map((r) => ({
        id: r.id,
        charge: { id: r.charge.id, customerName: r.charge.customer.name, valueCents: r.charge.valueCents },
        kind: r.kind,
        channel: r.channel,
        offsetDays: r.offsetDays,
        referenceDate: toDateOnly(r.referenceDate),
        status: r.status,
        error: r.error,
        sentAt: r.sentAt.toISOString(),
      })),
      meta: { page: q.page, pageSize: q.pageSize, total },
      summary,
    };
  }

  /** Específica do dia → geral do tipo (REG-08.2). */
  private async resolve(kind: ReminderKind, channel: 'EMAIL' | 'WHATSAPP', offset: number) {
    const rows = await this.prisma.reminderTemplate.findMany({ where: { kind, channel, OR: [{ offsetDays: offset }, { offsetDays: null }] } });
    return rows.find((r) => r.offsetDays === offset) ?? rows.find((r) => r.offsetDays === null) ?? null;
  }

  /** REG-01.2: valores das variáveis; garante Pix e linha digitável da cobrança em aberto. */
  private async values(charge: Charge & { customer: Customer }, kind: ReminderKind, offset: number): Promise<Partial<Record<ReminderVariable, string>>> {
    let pix = charge.pixPayload;
    let line = charge.identificationField;
    if ((OPEN as readonly string[]).includes(charge.status) && charge.asaasPaymentId && (!pix || !line)) {
      const info = await this.charges.paymentInfo(charge.id).catch(() => null);
      pix = info?.pixPayload ?? pix;
      line = info?.identificationField ?? line;
    }
    const settings = await this.prisma.settings.findUnique({ where: { id: 1 }, select: { companyName: true } });
    const due = toDateOnly(charge.dueDate);
    const today = todayInSaoPaulo();
    return {
      cliente: charge.customer.name,
      valor: formatBRL(charge.valueCents),
      vencimento: br(due),
      link: charge.invoiceUrl ?? '',
      pix: pix ?? '',
      linha_digitavel: line ?? '',
      empresa: settings?.companyName ?? '',
      servicos: charge.description,
      parcela: charge.installmentNumber ? `${charge.installmentNumber}/${charge.installmentCount}` : '',
      dias_para_vencer: String(kind === 'BEFORE_DUE' && offset < 0 ? -offset : Math.max(0, daysBetween(today, due))),
      dias_atraso: String(kind === 'AFTER_DUE' && offset > 0 ? offset : Math.max(0, daysBetween(due, today))),
      data_pagamento: charge.paidAt ? br(toDateOnly(charge.paidAt)) : '',
      valor_estornado: formatBRL(charge.refundedCents),
    };
  }
}
