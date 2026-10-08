import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { addDays, addMonthsClamped, fromCents, splitInstallments, todayInSaoPaulo, type Cycle } from '@financeiro/shared';
import type { Env } from '../../config/env.schema';
import type {
  AsaasClient,
  AsaasCustomer,
  AsaasCustomerInput,
  AsaasIdentificationField,
  AsaasPage,
  AsaasPayment,
  AsaasPaymentFilter,
  AsaasPaymentInput,
  AsaasPingResult,
  AsaasPixQrCode,
  AsaasSubscription,
  AsaasSubscriptionInput,
} from './asaas.client';
import { AsaasError } from './http-asaas.client';

interface MockRefund {
  valueCents: number;
  date: string;
}
type MockPayment = AsaasPayment & { refunds: MockRefund[]; confirmedDate: string | null };
interface MockState {
  customers: Record<string, AsaasCustomer & AsaasCustomerInput>;
  payments: Record<string, MockPayment>;
  subscriptions: Record<string, AsaasSubscription>;
}

/** Evento no formato do webhook do Asaas (valores em reais), entregue ao inbox pelo AsaasMockModule. */
export interface MockWebhookEvent {
  id: string;
  event: string;
  dateCreated: string;
  payment: Record<string, unknown>;
}
export type MockSimulation = 'RECEIVE' | 'OVERDUE';

const MONTHS: Partial<Record<Cycle, number>> = { MONTHLY: 1, BIMONTHLY: 2, QUARTERLY: 3, SEMIANNUALLY: 6, YEARLY: 12 };
const DAYS: Partial<Record<Cycle, number>> = { WEEKLY: 7, BIWEEKLY: 14 };
const nextCycle = (date: string, cycle: Cycle) => (MONTHS[cycle] ? addMonthsClamped(date, MONTHS[cycle]!) : addDays(date, DAYS[cycle]!));
const shortId = () => randomUUID().replace(/-/g, '').slice(0, 12);
const paidStatuses = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'];

/** Taxa fictícia para o líquido parecer real (Pix R$ 0,99; boleto R$ 1,99; cartão 2,99% + R$ 0,49). */
function fee(payment: AsaasPayment): number {
  if (payment.billingType === 'BOLETO') return 199;
  if (payment.billingType === 'CREDIT_CARD') return Math.round(payment.valueCents * 0.0299) + 49;
  return 99;
}

function invalid(description: string): AsaasError {
  return new AsaasError('ASAAS_VALIDATION', false, { errors: [{ description }] });
}

/**
 * ADR-016: Asaas simulado (ASAAS_ENV=mock) para usar o sistema sem conta no Asaas.
 * Guarda o estado em `<STORAGE_LOCAL_DIR>/asaas-mock.json` e avisa as mudanças como webhooks,
 * que seguem o caminho real (inbox → fila → processador).
 */
@Injectable()
export class MockAsaasClient implements AsaasClient {
  private readonly logger = new Logger(MockAsaasClient.name);
  private readonly file: string;
  private readonly webOrigin: string;
  private state: MockState | null = null;
  private lock: Promise<unknown> = Promise.resolve();
  private listener: ((event: MockWebhookEvent) => Promise<void>) | null = null;

  constructor(config: ConfigService<Env, true>) {
    this.file = join(config.get('STORAGE_LOCAL_DIR', { infer: true }), 'asaas-mock.json');
    this.webOrigin = config.get('WEB_ORIGIN', { infer: true });
  }

  onEvent(listener: (event: MockWebhookEvent) => Promise<void>) {
    this.listener = listener;
  }

  async ping(): Promise<AsaasPingResult> {
    return { ok: true, latencyMs: 0, error: null };
  }

  findCustomerByDocument(cpfCnpj: string): Promise<AsaasCustomer | null> {
    return this.read((s) => Object.values(s.customers).find((c) => c.cpfCnpj === cpfCnpj && !c.deleted) ?? null);
  }

  createCustomer(input: AsaasCustomerInput): Promise<AsaasCustomer> {
    return this.write((s) => {
      const customer = { ...input, id: `cus_mock_${shortId()}`, deleted: false };
      s.customers[customer.id] = customer;
      return customer;
    });
  }

  updateCustomer(id: string, input: AsaasCustomerInput): Promise<AsaasCustomer> {
    return this.write((s) => {
      const current = s.customers[id];
      if (!current) throw new AsaasError('ASAAS_NOT_FOUND', false);
      return (s.customers[id] = { ...current, ...input, id });
    });
  }

  async createPayment(input: AsaasPaymentInput): Promise<AsaasPayment> {
    return this.write((s) => {
      if (!s.customers[input.customer]) throw invalid('Cliente inexistente no Asaas simulado.');
      const n = input.installmentCount ?? 1;
      const installment = n > 1 ? `ins_mock_${shortId()}` : null;
      const values = n > 1 ? splitInstallments(input.totalValueCents ?? input.valueCents, n) : [input.valueCents];
      const created = values.map((valueCents, i) =>
        this.newPayment(s, {
          customer: input.customer,
          billingType: input.billingType,
          valueCents,
          dueDate: addMonthsClamped(input.dueDate, i),
          description: n > 1 ? `Parcela ${i + 1} de ${n}. ${input.description}` : input.description,
          externalReference: input.externalReference,
          installment,
          installmentNumber: installment ? i + 1 : null,
          subscription: null,
        }),
      );
      return created[0]!;
    });
  }

  getPayment(id: string): Promise<AsaasPayment> {
    return this.read((s) => {
      const payment = s.payments[id];
      if (!payment) throw new AsaasError('ASAAS_NOT_FOUND', false);
      return payment;
    });
  }

  listPayments(filter: AsaasPaymentFilter): Promise<AsaasPage<AsaasPayment>> {
    return this.read((s) => {
      const all = Object.values(s.payments)
        .filter(
          (p) =>
            !p.deleted &&
            (!filter.externalReference || p.externalReference === filter.externalReference) &&
            (!filter.installment || p.installment === filter.installment) &&
            (!filter.subscription || p.subscription === filter.subscription),
        )
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
      const offset = filter.offset ?? 0;
      const limit = filter.limit ?? 100;
      return { data: all.slice(offset, offset + limit), hasMore: offset + limit < all.length, totalCount: all.length };
    });
  }

  async deletePayment(id: string): Promise<void> {
    await this.write((s) => {
      const payment = this.payment(s, id);
      if (!['PENDING', 'OVERDUE'].includes(payment.status)) throw invalid('Só cobrança pendente ou vencida pode ser removida.');
      payment.deleted = true;
      this.emit('PAYMENT_DELETED', payment);
    });
  }

  async getPixQrCode(id: string): Promise<AsaasPixQrCode> {
    const payment = await this.getPayment(id);
    const payload = `00020101021226820014br.gov.bcb.pix2560simulado.asaas.local/qr/${id}5204000053039865406${fromCents(payment.valueCents).toFixed(2)}5802BR6304MOCK`;
    return { encodedImage: fakeQrPng(id), payload, expirationDate: null };
  }

  async getIdentificationField(id: string): Promise<AsaasIdentificationField> {
    await this.getPayment(id);
    const digits = BigInt(`0x${createHash('sha256').update(id).digest('hex')}`).toString().padEnd(47, '0').slice(0, 47);
    return { identificationField: digits, barCode: digits.slice(0, 44) };
  }

  refundPayment(id: string, valueCents?: number): Promise<AsaasPayment> {
    return this.write((s) => {
      const payment = this.payment(s, id);
      if (!paidStatuses.includes(payment.status)) throw invalid('Só cobrança paga pode ser estornada.');
      const refunded = payment.refunds.reduce((sum, r) => sum + r.valueCents, 0);
      const balance = payment.valueCents - refunded;
      const value = valueCents ?? balance;
      if (value <= 0 || value > balance) throw invalid('Valor de estorno maior que o saldo da cobrança.');
      payment.refunds.push({ valueCents: value, date: todayInSaoPaulo() });
      if (value === balance) {
        payment.status = 'REFUNDED';
        this.emit('PAYMENT_REFUNDED', payment);
      } else {
        this.emit('PAYMENT_PARTIALLY_REFUNDED', payment);
      }
      return payment;
    });
  }

  createSubscription(input: AsaasSubscriptionInput): Promise<AsaasSubscription> {
    return this.write((s) => {
      if (!s.customers[input.customer]) throw invalid('Cliente inexistente no Asaas simulado.');
      const subscription: AsaasSubscription = {
        id: `sub_mock_${shortId()}`,
        customer: input.customer,
        status: 'ACTIVE',
        billingType: input.billingType,
        valueCents: input.valueCents,
        nextDueDate: input.nextDueDate,
        cycle: input.cycle,
        endDate: input.endDate ?? null,
        description: input.description,
        externalReference: input.externalReference,
        deleted: false,
      };
      s.subscriptions[subscription.id] = subscription;
      this.nextSubscriptionPayment(s, subscription);
      return subscription;
    });
  }

  getSubscription(id: string): Promise<AsaasSubscription> {
    return this.read((s) => {
      const subscription = s.subscriptions[id];
      if (!subscription) throw new AsaasError('ASAAS_NOT_FOUND', false);
      return subscription;
    });
  }

  listSubscriptions(filter: { externalReference?: string }): Promise<AsaasPage<AsaasSubscription>> {
    return this.read((s) => {
      const data = Object.values(s.subscriptions).filter(
        (sub) => !sub.deleted && (!filter.externalReference || sub.externalReference === filter.externalReference),
      );
      return { data, hasMore: false, totalCount: data.length };
    });
  }

  async deleteSubscription(id: string): Promise<void> {
    await this.write((s) => {
      const subscription = s.subscriptions[id];
      if (!subscription) throw new AsaasError('ASAAS_NOT_FOUND', false);
      subscription.deleted = true;
      subscription.status = 'INACTIVE';
      // Como no Asaas: remover a assinatura remove as cobranças ainda não pagas.
      for (const payment of Object.values(s.payments)) {
        if (payment.subscription === id && !payment.deleted && ['PENDING', 'OVERDUE'].includes(payment.status)) {
          payment.deleted = true;
          this.emit('PAYMENT_DELETED', payment);
        }
      }
    });
  }

  /** "Simular pagamento" / "Simular vencimento" (ADR-016). */
  simulate(id: string, action: MockSimulation): Promise<AsaasPayment> {
    return this.write((s) => {
      const payment = this.payment(s, id);
      if (payment.deleted) throw invalid('Cobrança removida.');
      if (action === 'OVERDUE') {
        if (payment.status !== 'PENDING') throw invalid('Só cobrança pendente pode vencer.');
        payment.status = 'OVERDUE';
        this.emit('PAYMENT_OVERDUE', payment);
        return payment;
      }
      if (!['PENDING', 'OVERDUE'].includes(payment.status)) throw invalid('Esta cobrança não está em aberto.');
      payment.status = 'RECEIVED';
      payment.paymentDate = todayInSaoPaulo();
      payment.netValueCents = payment.valueCents - fee(payment);
      this.emit('PAYMENT_RECEIVED', payment);
      const subscription = payment.subscription ? s.subscriptions[payment.subscription] : undefined;
      if (subscription && !subscription.deleted) this.nextSubscriptionPayment(s, subscription);
      return payment;
    });
  }

  /** Gera a cobrança do próximo ciclo (o Asaas real gera alguns dias antes do vencimento). */
  private nextSubscriptionPayment(s: MockState, subscription: AsaasSubscription) {
    if (subscription.endDate && subscription.nextDueDate > subscription.endDate) {
      subscription.status = 'EXPIRED';
      return;
    }
    const payment = this.newPayment(s, {
      customer: subscription.customer,
      billingType: subscription.billingType,
      valueCents: subscription.valueCents,
      dueDate: subscription.nextDueDate,
      description: subscription.description ?? '',
      externalReference: null,
      installment: null,
      installmentNumber: null,
      subscription: subscription.id,
    });
    subscription.nextDueDate = nextCycle(subscription.nextDueDate, subscription.cycle);
    this.emit('PAYMENT_CREATED', payment);
  }

  private newPayment(
    s: MockState,
    p: Pick<AsaasPayment, 'customer' | 'billingType' | 'valueCents' | 'dueDate' | 'description' | 'externalReference' | 'installment' | 'installmentNumber' | 'subscription'>,
  ): MockPayment {
    const id = `pay_mock_${shortId()}`;
    const payment: MockPayment = {
      ...p,
      id,
      status: 'PENDING',
      netValueCents: null,
      paymentDate: null,
      confirmedDate: null,
      invoiceUrl: `${this.webOrigin}/api/v1/asaas-mock/fatura/${id}`,
      bankSlipUrl: p.billingType === 'BOLETO' || p.billingType === 'UNDEFINED' ? `${this.webOrigin}/api/v1/asaas-mock/fatura/${id}` : null,
      deleted: false,
      refunds: [],
    };
    s.payments[id] = payment;
    return payment;
  }

  private payment(s: MockState, id: string): MockPayment {
    const payment = s.payments[id];
    if (!payment) throw new AsaasError('ASAAS_NOT_FOUND', false);
    return payment;
  }

  /** Eventos saem depois de gravar o estado, fora da trava, como num webhook de verdade. */
  private pending: MockWebhookEvent[] = [];
  private emit(event: string, payment: MockPayment) {
    const now = new Date(Date.now() - 3 * 3600_000).toISOString(); // horário de Brasília, sem fuso (como o Asaas)
    this.pending.push({
      id: `evt_mock_${randomUUID()}`,
      event,
      dateCreated: `${now.slice(0, 10)} ${now.slice(11, 19)}`,
      payment: {
        object: 'payment',
        id: payment.id,
        customer: payment.customer,
        status: payment.status,
        billingType: payment.billingType,
        value: fromCents(payment.valueCents),
        netValue: payment.netValueCents === null ? null : fromCents(payment.netValueCents),
        dueDate: payment.dueDate,
        paymentDate: payment.paymentDate,
        clientPaymentDate: payment.paymentDate,
        description: payment.description,
        externalReference: payment.externalReference,
        installment: payment.installment,
        installmentNumber: payment.installmentNumber,
        subscription: payment.subscription,
        invoiceUrl: payment.invoiceUrl,
        bankSlipUrl: payment.bankSlipUrl,
        deleted: payment.deleted,
        refunds: payment.refunds.map((r) => ({ value: fromCents(r.valueCents), status: 'DONE', dateCreated: r.date })),
      },
    });
  }

  private async load(): Promise<MockState> {
    if (this.state) return this.state;
    try {
      this.state = JSON.parse(await readFile(this.file, 'utf8')) as MockState;
    } catch {
      this.state = { customers: {}, payments: {}, subscriptions: {} };
    }
    return this.state;
  }

  private read<T>(fn: (s: MockState) => T): Promise<T> {
    return this.load().then(fn);
  }

  /** Uma escrita por vez; o arquivo é regravado inteiro (volume de teste, não de produção). */
  private write<T>(fn: (s: MockState) => T): Promise<T> {
    const run = this.lock.then(async () => {
      const state = await this.load();
      const snapshot = structuredClone(state);
      try {
        const result = fn(state);
        await mkdir(dirname(this.file), { recursive: true });
        await writeFile(this.file, JSON.stringify(state));
        return structuredClone(result);
      } catch (error) {
        this.state = snapshot;
        this.pending = [];
        throw error;
      }
    });
    this.lock = run.catch(() => undefined);
    return run.finally(() => this.flush());
  }

  private flush() {
    const events = this.pending;
    this.pending = [];
    for (const event of events) {
      this.listener?.(event).catch((error: unknown) =>
        this.logger.warn(`Evento simulado ${event.event} não registrado: ${error instanceof Error ? error.message : error}`),
      );
    }
  }
}

/** QR Code de mentira (padrão determinístico 29×29), só para a tela ficar parecida com a real. */
function fakeQrPng(seed: string): string {
  const modules = 29;
  const scale = 6;
  const size = modules * scale;
  const bits = createHash('sha512').update(seed).digest();
  const finder = (x: number, y: number) =>
    [[0, 0], [modules - 7, 0], [0, modules - 7]].some(([fx, fy]) => {
      const dx = x - fx!;
      const dy = y - fy!;
      if (dx < 0 || dy < 0 || dx > 6 || dy > 6) return false;
      return dx === 0 || dy === 0 || dx === 6 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4);
    });
  const inFinderArea = (x: number, y: number) => (x < 8 && y < 8) || (x >= modules - 8 && y < 8) || (x < 8 && y >= modules - 8);
  const dark = (x: number, y: number) => {
    if (inFinderArea(x, y)) return finder(x, y);
    const i = y * modules + x;
    return ((bits[i % bits.length]! >> (i % 8)) & 1) === 1;
  };
  const raw = Buffer.alloc(size * (size + 1));
  for (let py = 0; py < size; py++) {
    raw[py * (size + 1)] = 0;
    for (let px = 0; px < size; px++) raw[py * (size + 1) + 1 + px] = dark(Math.floor(px / scale), Math.floor(py / scale)) ? 0 : 255;
  }
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // 8 bits
  header[9] = 0; // tons de cinza
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]).toString('base64');
}
