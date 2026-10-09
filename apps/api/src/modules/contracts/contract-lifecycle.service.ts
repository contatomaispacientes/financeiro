import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { addDays, todayInSaoPaulo, toSaoPauloDate, type ChargePlan } from '@financeiro/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { CONTRACT_PROVIDER, type ContractProvider, type NormalizedContractEvent } from '../../integrations/contracts/contract-provider';
import { StorageService } from '../../integrations/storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { enqueueUnique } from '../../queues/enqueue';
import {
  CONTRACT_CHARGE_JOB,
  CONTRACT_CHARGE_JOB_OPTIONS,
  CONTRACT_CHARGE_QUEUE,
  CONTRACT_FILE_JOB,
  CONTRACT_FILE_JOB_OPTIONS,
  CONTRACT_FILE_QUEUE,
  contractChargeJobId,
  contractFileJobId,
} from '../../queues/contracts';
import { AuditService } from '../audit/audit.service';
import { ChargesService } from '../charges/charges.service';

type EventResult = 'APPLIED' | 'IGNORED' | 'IGNORED_TRANSITION' | 'UNKNOWN_RESOURCE';
const OPEN = ['SENT', 'PARTIALLY_SIGNED'];
const FINAL = ['SIGNED', 'REFUSED', 'CANCELED', 'EXPIRED'];

/** CTR-04 (eventos do provedor), CTR-05 (cobrança na assinatura), CTR-04.3 (PDF) e CTR-06.3 (expiração). */
@Injectable()
export class ContractLifecycleService {
  private readonly logger = new Logger(ContractLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly charges: ChargesService,
    private readonly storage: StorageService,
    @Inject(CONTRACT_PROVIDER) private readonly provider: ContractProvider,
    @InjectQueue(CONTRACT_CHARGE_QUEUE) private readonly chargeQueue: Queue,
    @InjectQueue(CONTRACT_FILE_QUEUE) private readonly fileQueue: Queue,
  ) {}

  /** Aplica um `webhook_events` de origem CONTRACT; repetido ou reprocessado não muda nada (CTR-05.3). */
  async applyEvent(webhookEventId: string): Promise<EventResult | null> {
    const evt = await this.prisma.webhookEvent.findUnique({ where: { id: webhookEventId } });
    if (!evt || evt.processedAt) return null;
    await this.prisma.webhookEvent.update({ where: { id: evt.id }, data: { attempts: { increment: 1 } } });
    try {
      return await this.process(evt.id, evt.payload as unknown as NormalizedContractEvent);
    } catch (error) {
      await this.prisma.webhookEvent.update({ where: { id: evt.id }, data: { error: error instanceof Error ? error.message : String(error) } });
      throw error;
    }
  }

  private async process(eventId: string, e: NormalizedContractEvent): Promise<EventResult> {
    if (e.type === 'IGNORED') return this.finish(eventId, 'IGNORED');
    const found = await this.prisma.contract.findFirst({
      where: { OR: [{ providerDocumentId: e.providerDocumentId }, { providerEnvelopeId: e.providerDocumentId }] },
      select: { id: true },
    });
    if (!found) return this.finish(eventId, 'UNKNOWN_RESOURCE');

    let completed = false;
    const result = await this.prisma.$transaction(async (tx): Promise<EventResult> => {
      await tx.$queryRaw`SELECT id FROM contracts WHERE id = ${found.id}::uuid FOR UPDATE`;
      const c = await tx.contract.findUniqueOrThrow({ where: { id: found.id }, include: { signers: true } });
      const at = new Date(e.at);

      const complete = async () => {
        await tx.contract.update({ where: { id: c.id }, data: { status: 'SIGNED', signedAt: at } });
        await tx.contractSigner.updateMany({ where: { contractId: c.id, status: 'PENDING' }, data: { status: 'SIGNED', signedAt: at } });
        await this.audit.record({ action: 'contract.signed', entity: 'contract', entityId: c.id }, tx);
        completed = true;
      };

      // CTR-04.6: assinatura de contrato cancelado/expirado não gera cobrança, só alerta.
      if ((e.type === 'SIGNER_SIGNED' || e.type === 'DOCUMENT_COMPLETED') && (c.status === 'CANCELED' || c.status === 'EXPIRED')) {
        this.logger.warn(`Assinatura recebida para contrato ${c.id} em ${c.status}`);
        await this.audit.record({ action: 'contract.late_signature', entity: 'contract', entityId: c.id, data: { status: c.status } }, tx);
        return 'IGNORED_TRANSITION';
      }

      switch (e.type) {
        case 'SIGNER_SIGNED': {
          if (!OPEN.includes(c.status)) return 'IGNORED_TRANSITION';
          const signer = c.signers.find((s) => (e.providerSignerId && s.providerSignerId === e.providerSignerId) || (e.signerEmail && s.email === e.signerEmail));
          if (signer && signer.status === 'PENDING') {
            await tx.contractSigner.update({ where: { id: signer.id }, data: { status: 'SIGNED', signedAt: at } });
          }
          const pending = c.signers.filter((s) => s.status === 'PENDING' && s.id !== signer?.id);
          if (pending.length === 0) await complete();
          else await tx.contract.update({ where: { id: c.id }, data: { status: 'PARTIALLY_SIGNED' } });
          return 'APPLIED';
        }
        case 'DOCUMENT_COMPLETED': {
          // Um segundo "concluído" ainda pode disparar o download que faltou.
          if (c.status === 'SIGNED') {
            if (!c.signedFileKey) completed = true;
            return 'IGNORED_TRANSITION';
          }
          if (!OPEN.includes(c.status)) return 'IGNORED_TRANSITION';
          await complete();
          return 'APPLIED';
        }
        case 'SIGNER_REFUSED': {
          if (!OPEN.includes(c.status)) return 'IGNORED_TRANSITION';
          const signer = c.signers.find((s) => (e.providerSignerId && s.providerSignerId === e.providerSignerId) || (e.signerEmail && s.email === e.signerEmail));
          if (signer) await tx.contractSigner.update({ where: { id: signer.id }, data: { status: 'REFUSED' } });
          await tx.contract.update({ where: { id: c.id }, data: { status: 'REFUSED', providerError: e.reason ? `Recusado: ${e.reason}` : null } });
          await this.audit.record({ action: 'contract.refused', entity: 'contract', entityId: c.id, data: { reason: e.reason ?? null } }, tx);
          return 'APPLIED';
        }
        case 'DOCUMENT_EXPIRED':
        case 'DOCUMENT_CANCELED': {
          if (FINAL.includes(c.status)) return 'IGNORED_TRANSITION';
          await tx.contract.update({
            where: { id: c.id },
            data: e.type === 'DOCUMENT_EXPIRED' ? { status: 'EXPIRED' } : { status: 'CANCELED', canceledAt: at },
          });
          return 'APPLIED';
        }
      }
    });

    await this.finish(eventId, result);
    if (completed) await this.afterSigned(found.id);
    return result;
  }

  /** CTR-05.1 e CTR-04.3: cobrança e PDF em filas próprias (uma vez por contrato: `jobId` fixo). */
  private async afterSigned(contractId: string) {
    const c = await this.prisma.contract.findUniqueOrThrow({ where: { id: contractId }, select: { chargeGeneratedAt: true, signedFileKey: true } });
    if (!c.chargeGeneratedAt) {
      await enqueueUnique(this.chargeQueue, CONTRACT_CHARGE_JOB, { contractId }, contractChargeJobId(contractId), CONTRACT_CHARGE_JOB_OPTIONS);
    }
    if (!c.signedFileKey) {
      await enqueueUnique(this.fileQueue, CONTRACT_FILE_JOB, { contractId }, contractFileJobId(contractId), CONTRACT_FILE_JOB_OPTIONS);
    }
  }

  /**
   * CTR-05: gera pelo mesmo caminho da Nova Cobrança, no máximo uma vez (`charge_generated_at` + chave
   * `ctr_<id>`). Vencimento que já passou (data fixa ou geração tardia) vira hoje + `contract_charge_due_days`.
   */
  async generateCharge(contractId: string): Promise<void> {
    const c = await this.prisma.contract.findUnique({ where: { id: contractId } });
    if (!c || c.chargeGeneratedAt || c.status !== 'SIGNED' || !c.signedAt) return;
    const settings = await this.prisma.settings.findUnique({ where: { id: 1 }, select: { contractChargeDueDays: true } });
    const today = todayInSaoPaulo();
    let plan = c.chargePlan as ChargePlan;
    const due = plan.dueDate.mode === 'FIXED_DATE' ? plan.dueDate.date : addDays(toSaoPauloDate(c.signedAt), plan.dueDate.days);
    if (due < today) {
      const adjusted = addDays(today, settings?.contractChargeDueDays ?? 3);
      plan = { ...plan, dueDate: { mode: 'FIXED_DATE', date: adjusted } };
      await this.audit.record({ action: 'contract.due_date_adjusted', entity: 'contract', entityId: c.id, data: { from: due, to: adjusted } });
    }

    try {
      const created = await this.charges.createFromPlanDetailed(c.customerId, plan, {
        origin: 'CONTRACT',
        contractId: c.id,
        signedAt: c.signedAt,
        idempotencyKey: `ctr_${c.id}`,
      });
      await this.prisma.$transaction(async (tx) => {
        await tx.contract.update({ where: { id: c.id }, data: { chargeGeneratedAt: new Date(), chargeError: null } });
        await this.audit.record(
          { action: 'contract.charge_generated', entity: 'contract', entityId: c.id, data: { chargeIds: created.chargeIds, subscriptionId: created.subscriptionId ?? null } },
          tx,
        );
      });
    } catch (error) {
      await this.prisma.contract.update({ where: { id: c.id }, data: { chargeError: error instanceof Error ? error.message : String(error) } });
      throw error;
    }
  }

  /** CTR-04.3: falha aqui não impede a cobrança; a fila tenta de novo. */
  async downloadSignedFile(contractId: string): Promise<void> {
    const c = await this.prisma.contract.findUnique({ where: { id: contractId }, select: { signedFileKey: true, providerDocumentId: true, status: true } });
    if (!c || c.signedFileKey || !c.providerDocumentId || c.status !== 'SIGNED') return;
    const file = await this.provider.downloadSignedFile(c.providerDocumentId);
    const key = `contracts/${contractId}/assinado.pdf`;
    await this.storage.put(key, file.data);
    await this.prisma.contract.update({ where: { id: contractId }, data: { signedFileKey: key } });
  }

  /** CTR-06.3: enviados com validade vencida → cancelados no provedor e EXPIRED. */
  async expireOverdue(): Promise<number> {
    const overdue = await this.prisma.contract.findMany({
      where: { status: { in: ['SENT', 'PARTIALLY_SIGNED'] }, expiresAt: { lt: new Date() } },
      select: { id: true, providerDocumentId: true },
    });
    for (const c of overdue) {
      if (c.providerDocumentId) {
        await this.provider.cancelDocument(c.providerDocumentId).catch((error: unknown) =>
          this.logger.warn(`Contrato ${c.id}: cancelamento no provedor falhou (${error instanceof Error ? error.message : error})`),
        );
      }
      await this.prisma.$transaction(async (tx) => {
        await tx.contract.updateMany({ where: { id: c.id, status: { in: ['SENT', 'PARTIALLY_SIGNED'] } }, data: { status: 'EXPIRED' } });
        await this.audit.record({ action: 'contract.expire', entity: 'contract', entityId: c.id }, tx);
      });
    }
    return overdue.length;
  }

  private async finish(id: string, result: EventResult, db: Prisma.TransactionClient = this.prisma): Promise<EventResult> {
    await db.webhookEvent.update({ where: { id }, data: { processedAt: new Date(), result, error: null } });
    return result;
  }
}
