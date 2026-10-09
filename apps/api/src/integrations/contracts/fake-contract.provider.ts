import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import {
  ContractProviderError,
  type ContractProvider,
  type CreateDocumentInput,
  type NormalizedContractEvent,
  type ProviderDocument,
  type ProviderProgress,
} from './contract-provider';

interface FakeSigner {
  externalId: string;
  providerSignerId: string;
  name: string;
  email: string;
  status: 'PENDING' | 'SIGNED' | 'REFUSED';
  signedAt?: string;
}
interface FakeDocument {
  id: string;
  envelopeId: string;
  title: string;
  fields: Record<string, string>;
  status: ProviderDocument['status'];
  signers: FakeSigner[];
}
type Step = 'envelope' | 'document' | 'signers' | 'requirements' | 'activate';

export interface FakeSignPage {
  title: string;
  status: FakeDocument['status'];
  fields: Record<string, string>;
  signer: FakeSigner;
}

/**
 * ADR-005: provedor de assinatura de mentira (dev, testes e demonstração sem Clicksign). Imita os passos do
 * Clicksign (envelope → documento → signatários → requisitos → ativar) e assina webhooks com o mesmo
 * esquema `Content-Hmac`. Estado em `<STORAGE_LOCAL_DIR>/fake-contracts.json`.
 */
@Injectable()
export class FakeContractProvider implements ContractProvider {
  readonly name = 'fake' as const;
  private readonly file: string;
  private readonly secret: string;
  private readonly webOrigin: string;
  private docs: Record<string, FakeDocument> | null = null;
  private failAt: Step | null = null;

  constructor(config: ConfigService<Env, true>) {
    this.file = join(config.get('STORAGE_LOCAL_DIR', { infer: true }), 'fake-contracts.json');
    this.secret = config.get('FAKE_CONTRACT_WEBHOOK_SECRET', { infer: true }) ?? `fake:${config.get('JWT_ACCESS_SECRET', { infer: true })}`;
    this.webOrigin = config.get('WEB_ORIGIN', { infer: true });
  }

  /** Testes: o próximo envio falha neste passo (CTR-03.3, retomada sem duplicar). */
  failOnceAt(step: Step) {
    this.failAt = step;
  }

  async createDocument(input: CreateDocumentInput): Promise<ProviderDocument> {
    const docs = await this.load();
    const progress: ProviderProgress = { ...input.resume, signerIds: { ...input.resume?.signerIds } };
    const step = async (name: Step, run: () => void) => {
      if (this.failAt === name) {
        this.failAt = null;
        throw new ContractProviderError(`Provedor simulado: falha no passo "${name}"`);
      }
      run();
      await this.save();
      await input.onProgress?.({ ...progress });
    };

    if (!progress.envelopeId) await step('envelope', () => (progress.envelopeId = `env_fake_${randomUUID().slice(0, 8)}`));
    if (!progress.documentId) {
      await step('document', () => {
        const id = `doc_fake_${randomUUID().slice(0, 8)}`;
        docs[id] = { id, envelopeId: progress.envelopeId!, title: input.title, fields: input.fields, status: 'PENDING', signers: [] };
        progress.documentId = id;
      });
    }
    const doc = docs[progress.documentId!]!;
    const missing = input.signers.filter((s) => !progress.signerIds![s.externalId]);
    if (missing.length) {
      await step('signers', () => {
        for (const s of missing) {
          const providerSignerId = `sig_fake_${randomUUID().slice(0, 8)}`;
          doc.signers.push({ externalId: s.externalId, providerSignerId, name: s.name, email: s.email, status: 'PENDING' });
          progress.signerIds![s.externalId] = providerSignerId;
        }
      });
    }
    if (!progress.requirementsDone) await step('requirements', () => (progress.requirementsDone = true));
    if (!progress.activated) await step('activate', () => (progress.activated = true));
    return this.toDocument(doc);
  }

  async getDocument(providerDocumentId: string): Promise<ProviderDocument> {
    return this.toDocument(await this.doc(providerDocumentId));
  }

  async cancelDocument(providerDocumentId: string): Promise<void> {
    const doc = await this.doc(providerDocumentId);
    if (doc.status === 'PENDING') doc.status = 'CANCELED';
    await this.save();
  }

  async resendToSigner(providerDocumentId: string): Promise<void> {
    await this.doc(providerDocumentId);
  }

  /** PDF mínimo válido com o título, só para demonstrar o arquivo assinado. */
  async downloadSignedFile(providerDocumentId: string): Promise<{ contentType: string; data: Buffer }> {
    const doc = await this.doc(providerDocumentId);
    const text = `Contrato assinado (simulado): ${doc.title}`.replace(/[()\\]/g, '').normalize('NFD').replace(/[̀-ͯ]/g, '');
    const stream = `BT /F1 14 Tf 50 780 Td (${text}) Tj ET`;
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];
    let pdf = '%PDF-1.4\n';
    const offsets: number[] = [];
    objects.forEach((o, i) => {
      offsets.push(pdf.length);
      pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
    });
    const xref = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return { contentType: 'application/pdf', data: Buffer.from(pdf, 'latin1') };
  }

  verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer): boolean {
    const header = headers['content-hmac'];
    const given = Buffer.from(String(Array.isArray(header) ? header[0] : (header ?? '')));
    const expected = Buffer.from(this.hmac(rawBody));
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  parseWebhook(body: unknown): NormalizedContractEvent[] {
    const events = (body as { events?: unknown[] } | null)?.events;
    if (!Array.isArray(events)) return [];
    return events as NormalizedContractEvent[];
  }

  // ───────── Página de assinatura simulada (/dev/fake-sign) ─────────

  async signPage(providerDocumentId: string, providerSignerId: string): Promise<FakeSignPage> {
    const doc = await this.doc(providerDocumentId);
    const signer = doc.signers.find((s) => s.providerSignerId === providerSignerId);
    if (!signer) throw new ContractProviderError('Signatário não encontrado no provedor simulado');
    return { title: doc.title, status: doc.status, fields: doc.fields, signer };
  }

  /** Assina ou recusa e devolve o corpo bruto + cabeçalhos do webhook, como o Clicksign mandaria. */
  async act(providerDocumentId: string, providerSignerId: string, action: 'sign' | 'refuse') {
    const doc = await this.doc(providerDocumentId);
    const signer = doc.signers.find((s) => s.providerSignerId === providerSignerId);
    if (!signer || doc.status !== 'PENDING' || signer.status !== 'PENDING') {
      throw new ContractProviderError('Este documento não está mais aguardando assinatura');
    }
    const at = new Date().toISOString();
    const events: NormalizedContractEvent[] = [];
    const id = (type: string) => createHash('sha256').update(`${doc.id}${type}${providerSignerId}${at}`).digest('hex').slice(0, 32);
    if (action === 'refuse') {
      signer.status = 'REFUSED';
      doc.status = 'REFUSED';
      events.push({ type: 'SIGNER_REFUSED', eventId: id('refuse'), providerDocumentId: doc.id, providerSignerId, signerEmail: signer.email, at, reason: 'Recusado na página simulada' });
    } else {
      signer.status = 'SIGNED';
      signer.signedAt = at;
      events.push({ type: 'SIGNER_SIGNED', eventId: id('sign'), providerDocumentId: doc.id, providerSignerId, signerEmail: signer.email, at });
      if (doc.signers.every((s) => s.status === 'SIGNED')) {
        doc.status = 'SIGNED';
        events.push({ type: 'DOCUMENT_COMPLETED', eventId: id('close'), providerDocumentId: doc.id, at }); // como o auto_close
      }
    }
    await this.save();
    const rawBody = Buffer.from(JSON.stringify({ events }));
    return { rawBody, headers: { 'content-hmac': this.hmac(rawBody), 'content-type': 'application/json' } };
  }

  private hmac(rawBody: Buffer): string {
    return `sha256=${createHmac('sha256', this.secret).update(rawBody).digest('hex')}`;
  }

  private toDocument(doc: FakeDocument): ProviderDocument {
    return {
      providerEnvelopeId: doc.envelopeId,
      providerDocumentId: doc.id,
      status: doc.status,
      signers: doc.signers.map((s) => ({
        externalId: s.externalId,
        providerSignerId: s.providerSignerId,
        signUrl: `${this.webOrigin}/api/v1/dev/fake-sign/${doc.id}/${s.providerSignerId}`,
        status: s.status,
        signedAt: s.signedAt ? new Date(s.signedAt) : undefined,
      })),
    };
  }

  private async doc(id: string): Promise<FakeDocument> {
    const doc = (await this.load())[id];
    if (!doc) throw new ContractProviderError('Documento não encontrado no provedor simulado');
    return doc;
  }

  private async load(): Promise<Record<string, FakeDocument>> {
    if (!this.docs) {
      try {
        this.docs = JSON.parse(await readFile(this.file, 'utf8')) as Record<string, FakeDocument>;
      } catch {
        this.docs = {};
      }
    }
    return this.docs;
  }

  private async save() {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(this.docs ?? {}));
  }
}
